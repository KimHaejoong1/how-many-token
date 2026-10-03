import { test } from "node:test";
import assert from "node:assert/strict";
import { readSessionUsage } from "../src/session-usage.js";

const sessionUrl = "https://chatgpt.com/api/auth/session";
const usageUrl = "https://chatgpt.com/backend-api/wham/usage";
const session = {
  accessToken: "private-test-token", user: { id: "user-a", email: "private@example.invalid" },
  account: { id: "account-a" }, expires: "2099-01-01T00:00:00Z"
};
const payload = {
  email: "private@example.invalid", account_id: "account-a", credits: { balance: 999 },
  rate_limit: { primary_window: { used_percent: 21, limit_window_seconds: 604800, reset_at: 1791114146 } }
};
const json = value => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });

function harness(replies = [session, payload, session]) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    assert.ok(replies.length, "unexpected network request");
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next instanceof Response ? next : json(next);
  };
  return { calls, read: () => readSessionUsage(fetcher) };
}

test("reads usage with the existing session and returns numbers only", async () => {
  const h = harness();
  const result = await h.read();
  assert.equal(result.ok, true);
  assert.equal(result.usage.remainingPercent, 79);
  assert.equal(result.usage.resetAt, 1791114146000);
  assert.ok(Number.isFinite(result.usage.fetchedAt));
  assert.doesNotMatch(JSON.stringify(result), /private|account-a|user-a|credits/);
  assert.deepEqual(h.calls.map(call => call.url), [sessionUrl, usageUrl, sessionUrl]);
  assert.deepEqual(h.calls.map(call => call.init.credentials), ["include", "omit", "include"]);
  assert.deepEqual(h.calls[1].init.headers, {
    Authorization: "Bearer private-test-token", "ChatGPT-Account-Id": "account-a"
  });
  for (const { init } of h.calls) {
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    assert.equal(init.method, "GET");
    assert.equal(init.headers.Cookie, undefined);
  }
});

test("missing, anonymous, or expired sessions do not make a usage request", async () => {
  for (const value of [null, {}, { user: {} }, { accessToken: "" },
    { ...session, expires: "2000-01-01T00:00:00Z" }]) {
    const h = harness([value]);
    assert.deepEqual(await h.read(), { ok: false, code: "LOGIN_REQUIRED" });
    assert.equal(h.calls.length, 1);
  }
});

test("malformed authentication fields are never sent as headers", async () => {
  for (const value of [
    { ...session, accessToken: "token\r\nInjected: header" },
    { ...session, accessToken: "x".repeat(16385) },
    { ...session, account: { id: "bad\naccount" } },
    { ...session, account: { id: 42 } }
  ]) {
    const h = harness([value]);
    assert.deepEqual(await h.read(), { ok: false, code: "UNSUPPORTED" });
    assert.equal(h.calls.length, 1);
  }
});

test("session without an account ID uses the server default", async () => {
  const personal = { accessToken: "personal-token" };
  const h = harness([personal, payload, personal]);
  assert.equal((await h.read()).ok, true);
  assert.deepEqual(h.calls[1].init.headers, { Authorization: "Bearer personal-token" });
});

test("token rotation for the same identified user and account succeeds", async () => {
  const h = harness([session, payload, { ...session, accessToken: "rotated-token" }]);
  assert.equal((await h.read()).ok, true);
});

test("logout and account changes during a request discard the result", async () => {
  for (const changed of [
    { ...session, user: { id: "user-b" } },
    { ...session, account: { id: "account-b" } }
  ]) {
    assert.deepEqual(await harness([session, payload, changed]).read(), { ok: false, code: "ACCOUNT_CHANGED" });
  }
  assert.deepEqual(await harness([session, payload, {}]).read(), { ok: false, code: "LOGIN_REQUIRED" });
  assert.deepEqual(await harness([{ accessToken: "first-token" }, payload, { accessToken: "second-token" }]).read(),
    { ok: false, code: "ACCOUNT_CHANGED" });
});

test("completed requests do not reuse credentials or an old usage result", async () => {
  const h = harness([session, payload, session, {}]);
  assert.equal((await h.read()).ok, true);
  assert.deepEqual(await h.read(), { ok: false, code: "LOGIN_REQUIRED" });
  assert.equal(h.calls.length, 4);
});

test("HTTP failures at either endpoint return actionable errors without retry loops", async () => {
  for (const [status, code] of [[401, "LOGIN_REQUIRED"], [403, "DIRECT_BLOCKED"], [429, "RATE_LIMITED"], [500, "SERVER"]]) {
    for (const prefix of [[], [session]]) {
      const h = harness([...prefix, new Response("{}", { status })]);
      assert.deepEqual(await h.read(), { ok: false, code });
      assert.equal(h.calls.length, prefix.length + 1);
    }
  }
});

test("HTML challenges, invalid JSON, and unsupported usage are not shown as full allowance", async () => {
  assert.deepEqual(await harness([new Response("<html>Sign in</html>", {
    headers: { "Content-Type": "text/html" }
  })]).read(), { ok: false, code: "DIRECT_BLOCKED" });
  assert.deepEqual(await harness([new Response("not json")]).read(), { ok: false, code: "UNSUPPORTED" });
  assert.deepEqual(await harness([session, { rate_limit: {} }]).read(), { ok: false, code: "UNSUPPORTED" });
});

test("network and abort failures never expose error details or credentials", async () => {
  assert.deepEqual(await harness([new Error("private-test-token")]).read(), { ok: false, code: "NETWORK" });
  assert.deepEqual(await harness([new DOMException("aborted", "AbortError")]).read(), { ok: false, code: "TIMEOUT" });
});

test("the entire request is bounded by a single twenty second timeout", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = readSessionUsage((url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  }));
  t.mock.timers.tick(20000);
  assert.deepEqual(await pending, { ok: false, code: "TIMEOUT" });
});
