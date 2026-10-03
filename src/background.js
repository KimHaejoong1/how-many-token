import { normalizeUsage } from "./usage.js";

const ORIGIN = "https://chatgpt.com/";
const USAGE_PAGE = `${ORIGIN}settings/usage?tab=overview`;
const pending = new Map();

async function readTab(tab) {
  if (pending.has(tab.id)) return pending.get(tab.id);
  const request = (async () => {
    let timer;
    try {
      const response = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { type: "READ_USAGE" }, { frameId: 0 }),
        new Promise(resolve => { timer = setTimeout(() => resolve({ ok: false, code: "TIMEOUT" }), 17000); })
      ]);
      if (!response?.ok) return { ok: false, code: response?.code || "NETWORK" };
      try { return { ok: true, usage: normalizeUsage(response.data) }; }
      catch { return { ok: false, code: "UNSUPPORTED" }; }
    } catch { return { ok: false, code: "RELOAD" }; }
    finally { clearTimeout(timer); }
  })().finally(() => pending.delete(tab.id));
  pending.set(tab.id, request);
  return request;
}

async function getUsage() {
  const [tabs, focused] = await Promise.all([
    chrome.tabs.query({ url: `${ORIGIN}*` }),
    chrome.tabs.query({ active: true, lastFocusedWindow: true })
  ]);
  const candidates = tabs.filter(tab => !tab.discarded && typeof tab.id === "number");
  if (!candidates.length) return { ok: false, code: "NO_TAB" };
  const focusedId = focused[0]?.id;
  candidates.sort((a, b) => Number(b.id === focusedId) - Number(a.id === focusedId) ||
    (b.lastAccessed || 0) - (a.lastAccessed || 0));
  // One tab determines the account. Do not fall back silently to an older tab's account.
  return readTab(candidates[0]);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only this extension's popup may initiate requests or open a tab.
  if (sender.id !== chrome.runtime.id || sender.tab || sender.url !== chrome.runtime.getURL("popup.html")) return;
  if (message?.type === "GET_USAGE") {
    getUsage().then(sendResponse, () => sendResponse({ ok: false, code: "NETWORK" }));
    return true;
  }
  if (message?.type === "OPEN_CHATGPT") {
    chrome.tabs.create({ url: USAGE_PAGE }).then(() => sendResponse({ ok: true }),
      () => sendResponse({ ok: false, code: "NETWORK" }));
    return true;
  }
});
