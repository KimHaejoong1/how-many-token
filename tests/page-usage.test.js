import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";

const source = readFileSync(new URL("../src/page-usage.js", import.meta.url), "utf8");
const bridgeSource = readFileSync(new URL("../src/content.js", import.meta.url), "utf8");
const endpoint = "https://chatgpt.com/backend-api/wham/usage";
const payload = {
  email: "private@example.invalid", account_id: "not-for-popup", credits: { balance: 999 },
  rate_limit: { primary_window: { used_percent: 21, limit_window_seconds: 604800, reset_at: 1791114146 }, secondary_window: null }
};

function harness(responder = async () => new Response(JSON.stringify(payload))) {
  const listeners = new Set();
  const calls = [];
  class XHR { open() {} setRequestHeader() {} send() {} }
  const window = {
    fetch: (...args) => {
      calls.push(args);
      return args[0] === endpoint && args[1]?.cache === "no-store"
        ? responder(...args) : Promise.resolve(new Response("{}"));
    },
    addEventListener: (type, handler) => { if (type === "message") listeners.add(handler); },
    removeEventListener: (type, handler) => listeners.delete(handler),
    postMessage: data => queueMicrotask(() => {
      for (const listener of listeners) listener({ source: window, origin: "https://chatgpt.com", data });
    })
  };
  runInNewContext(source, { window, location: { origin: "https://chatgpt.com", href: "https://chatgpt.com/" },
    Headers, Request, URL, XMLHttpRequest: XHR, AbortController, setTimeout, clearTimeout });
  async function authenticate(account = "account-a", token = "test-token") {
    await window.fetch("https://chatgpt.com/backend-api/test", {
      headers: { Authorization: `Bearer ${token}`, "ChatGPT-Account-Id": account }
    });
  }
  function read() {
    return new Promise(resolve => {
      const id = randomUUID();
      const receive = event => {
        if (event.data.type === "usage-response" && event.data.id === id) {
          listeners.delete(receive); resolve(JSON.parse(JSON.stringify(event.data.result)));
        }
      };
      listeners.add(receive);
      window.postMessage({ channel: "how-many-token/v1", type: "usage-request", id });
    });
  }
  function installBridge() {
    let listener;
    const chrome = { runtime: { id: "test-extension", onMessage: { addListener: callback => { listener = callback; } } } };
    runInNewContext(bridgeSource, { window, chrome, crypto: { randomUUID },
      location: { origin: "https://chatgpt.com" }, setTimeout, clearTimeout });
    return listener;
  }
  return { window, XHR, calls, authenticate, read, installBridge };
}

test("requires a real page authentication request, and ignores other origins", async () => {
  const h = harness();
  assert.deepEqual(await h.read(), { ok: false, code: "CONNECT" });
  await h.window.fetch("https://other.invalid/backend-api/test", { headers: { Authorization: "Bearer wrong" } });
  assert.deepEqual(await h.read(), { ok: false, code: "CONNECT" });
});
test("relays only numeric usage fields; credentials stay in the page request", async () => {
  const h = harness();
  await h.authenticate();
  const result = await h.read();
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.windows, [payload.rate_limit.primary_window]);
  assert.doesNotMatch(JSON.stringify(result), /test-token|private@|account-a|credits|account_id/);
  const probe = h.calls.find(([url, init]) => url === endpoint && init?.cache === "no-store");
  assert.equal(probe[1].credentials, "omit");
  assert.equal(probe[1].redirect, "error");
  assert.equal(probe[1].headers.Authorization, "Bearer test-token");
});
test("simultaneous popup requests share a single network call", async () => {
  const h = harness(); await h.authenticate();
  const results = await Promise.all([h.read(), h.read(), h.read()]);
  assert.ok(results.every(result => result.ok));
  assert.equal(h.calls.filter(([url]) => url === endpoint).length, 1);
});
test("expired credentials are forgotten, and a new page request reconnects", async () => {
  let expired = true;
  const h = harness(async () => expired ? new Response("{}", { status: 401 }) : new Response(JSON.stringify(payload)));
  await h.authenticate();
  assert.deepEqual(await h.read(), { ok: false, code: "CONNECT" });
  expired = false;
  assert.deepEqual(await h.read(), { ok: false, code: "CONNECT" });
  await h.authenticate("account-a", "fresh-token");
  assert.equal((await h.read()).ok, true);
});
test("account switches during a request never return the previous account's usage", async () => {
  let complete;
  const h = harness(() => new Promise(resolve => { complete = resolve; }));
  await h.authenticate();
  const pending = h.read();
  await new Promise(resolve => setImmediate(resolve));
  await h.authenticate("account-b");
  complete(new Response(JSON.stringify(payload)));
  assert.deepEqual(await pending, { ok: false, code: "ACCOUNT_CHANGED" });
});
test("site requests preserve their original arguments", async () => {
  const h = harness();
  const request = new Request("https://chatgpt.com/backend-api/test", { headers: { Authorization: "Bearer request-token" } });
  const init = { headers: { Authorization: "Bearer override-token" }, method: "GET" };
  await h.window.fetch(request, init);
  assert.equal(h.calls[0][0], request);
  assert.equal(h.calls[0][1], init);
  await h.read();
  assert.equal(h.calls.at(-1)[1].headers.Authorization, "Bearer override-token");
});
test("XHR-based site requests also establish the connection", async () => {
  const h = harness();
  const xhr = new h.XHR();
  xhr.open("GET", "/backend-api/test");
  xhr.setRequestHeader("Authorization", "Bearer xhr-token");
  xhr.send();
  assert.equal((await h.read()).ok, true);
});
test("account-neutral requests preserve the selected workspace", async () => {
  const h = harness(); await h.authenticate("selected-workspace");
  await h.window.fetch("https://chatgpt.com/backend-api/test", { headers: { Authorization: "Bearer test-token" } });
  await h.read();
  assert.equal(h.calls.at(-1)[1].headers["ChatGPT-Account-Id"], "selected-workspace");
});
test("content bridge completes the message round trip without credentials", async () => {
  const h = harness(); await h.authenticate();
  const listener = h.installBridge();
  const result = await new Promise(resolve => {
    assert.equal(listener({ type: "READ_USAGE" }, { id: "test-extension" }, resolve), true);
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.windows[0].used_percent, 21);
  assert.doesNotMatch(JSON.stringify(result), /test-token|private@|account-a/);
  assert.equal(listener({ type: "READ_USAGE" }, { id: "other-extension" }, () => assert.fail("untrusted sender")), undefined);
});
test("rate limits and blocked requests produce explicit errors", async () => {
  for (const [status, code] of [[403, "FORBIDDEN"], [429, "RATE_LIMITED"], [500, "SERVER"]]) {
    const h = harness(async () => new Response("{}", { status })); await h.authenticate();
    assert.deepEqual(await h.read(), { ok: false, code });
  }
});
