import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { normalizeUsage } from "../src/usage.js";

const source = readFileSync(new URL("../src/background.js", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "");
function harness(tabs = [], options = {}) {
  let listener;
  const queried = [];
  const created = [];
  let directCalls = 0;
  const runtime = {
    id: "test-extension", getURL: path => `chrome-extension://test-extension/${path}`,
    onMessage: { addListener: callback => { listener = callback; } }
  };
  const chrome = { runtime, tabs: {
    query: async filter => filter.active ? [{ id: options.focusedId }] : tabs,
    sendMessage: async id => {
      queried.push(id);
      if (options.disconnected) throw new Error("Receiving end does not exist");
      return options.result ?? { ok: true, data: { fetchedAt: 1000,
        windows: [{ used_percent: 21, limit_window_seconds: 604800, reset_at: 1791114146 }] } };
    },
    create: async tab => { created.push(tab); }
  } };
  const readSessionUsage = async () => {
    directCalls++;
    return options.directRead ? options.directRead()
      : { ok: true, usage: { remainingPercent: 42, resetAt: 1791114146000, fetchedAt: 1000 } };
  };
  runInNewContext(source, { chrome, normalizeUsage, readSessionUsage, setTimeout, clearTimeout });
  const sender = { id: runtime.id, url: runtime.getURL("popup.html") };
  function dispatch(type = "GET_USAGE") {
    return new Promise(resolve => listener({ type }, sender, value => resolve(JSON.parse(JSON.stringify(value)))));
  }
  return { dispatch, queried, created, listener, sender, get directCalls() { return directCalls; } };
}
test("no tab or only discarded tabs use the session without opening a tab", async () => {
  for (const tabs of [[], [{ id: 1, discarded: true }]]) {
    const h = harness(tabs);
    assert.equal((await h.dispatch()).usage.remainingPercent, 42);
    assert.equal(h.directCalls, 1);
    assert.deepEqual(h.queried, []);
    assert.deepEqual(h.created, []);
  }
});
test("selects the focused ChatGPT tab before the most recently accessed tab", async () => {
  const h = harness([{ id: 1, lastAccessed: 500 }, { id: 2, lastAccessed: 1 }], { focusedId: 2 });
  const result = await h.dispatch();
  assert.equal(result.usage.remainingPercent, 79);
  assert.deepEqual(h.queried, [2]);
  assert.equal(h.directCalls, 0);
});
test("does not silently fall back to an older account after a connection error", async () => {
  const h = harness([{ id: 1, lastAccessed: 100 }, { id: 2, lastAccessed: 500 }], { disconnected: true });
  assert.deepEqual(await h.dispatch(), { ok: false, code: "RELOAD" });
  assert.deepEqual(h.queried, [2]);
  assert.equal(h.directCalls, 0);
});
test("malformed page messages cannot become a usage reading", async () => {
  const h = harness([{ id: 1 }], { result: { ok: true, data: { token: "not-a-number" } } });
  assert.deepEqual(await h.dispatch(), { ok: false, code: "UNSUPPORTED" });
});
test("web pages cannot request background actions", () => {
  const h = harness();
  let answered = false;
  assert.equal(h.listener({ type: "OPEN_CHATGPT" }, { ...h.sender, tab: { id: 2 } }, () => { answered = true; }), undefined);
  assert.equal(answered, false);
  assert.equal(h.created.length, 0);
});
test("connect action opens only the fixed ChatGPT usage URL", async () => {
  const h = harness();
  assert.deepEqual(await h.dispatch("OPEN_CHATGPT"), { ok: true });
  assert.equal(h.created[0].url, "https://chatgpt.com/settings/usage?tab=overview");
});

test("concurrent requests share direct work, but completed results are not cached", async () => {
  let finish;
  const h = harness([], { directRead: () => new Promise(resolve => { finish = resolve; }) });
  const first = h.dispatch();
  const second = h.dispatch();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.directCalls, 1);
  finish({ ok: false, code: "LOGIN_REQUIRED" });
  assert.deepEqual(await Promise.all([first, second]), [
    { ok: false, code: "LOGIN_REQUIRED" }, { ok: false, code: "LOGIN_REQUIRED" }
  ]);
  const next = h.dispatch();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.directCalls, 2);
  finish({ ok: false, code: "DIRECT_BLOCKED" });
  assert.deepEqual(await next, { ok: false, code: "DIRECT_BLOCKED" });
});

test("untrusted messages cannot trigger direct authenticated requests", () => {
  const h = harness();
  for (const sender of [
    { ...h.sender, tab: { id: 2 } }, { ...h.sender, id: "other-extension" },
    { ...h.sender, url: "https://chatgpt.com/" }
  ]) {
    assert.equal(h.listener({ type: "GET_USAGE" }, sender, () => assert.fail("untrusted sender")), undefined);
  }
  assert.equal(h.directCalls, 0);
});
