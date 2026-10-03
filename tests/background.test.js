import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { normalizeUsage } from "../src/usage.js";

const source = readFileSync(new URL("../src/background.js", import.meta.url), "utf8").replace(/^import .*;\n/, "");
function harness(tabs = [], options = {}) {
  let listener;
  const queried = [];
  const created = [];
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
  runInNewContext(source, { chrome, normalizeUsage, setTimeout, clearTimeout });
  const sender = { id: runtime.id, url: runtime.getURL("popup.html") };
  function dispatch(type = "GET_USAGE") {
    return new Promise(resolve => listener({ type }, sender, value => resolve(JSON.parse(JSON.stringify(value)))));
  }
  return { dispatch, queried, created, listener, sender };
}
test("no tab or discarded tabs yield connection instructions", async () => {
  for (const tabs of [[], [{ id: 1, discarded: true }]]) {
    assert.deepEqual(await harness(tabs).dispatch(), { ok: false, code: "NO_TAB" });
  }
});
test("selects the focused ChatGPT tab before the most recently accessed tab", async () => {
  const h = harness([{ id: 1, lastAccessed: 500 }, { id: 2, lastAccessed: 1 }], { focusedId: 2 });
  const result = await h.dispatch();
  assert.equal(result.usage.remainingPercent, 79);
  assert.deepEqual(h.queried, [2]);
});
test("does not silently fall back to an older account after a connection error", async () => {
  const h = harness([{ id: 1, lastAccessed: 100 }, { id: 2, lastAccessed: 500 }], { disconnected: true });
  assert.deepEqual(await h.dispatch(), { ok: false, code: "RELOAD" });
  assert.deepEqual(h.queried, [2]);
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
