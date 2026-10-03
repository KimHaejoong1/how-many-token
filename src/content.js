(() => {
  "use strict";
  const CHANNEL = "how-many-token/v1";
  let pending = null;

  function readUsage() {
    if (pending) return pending;
    pending = new Promise(resolve => {
      const id = crypto.randomUUID();
      const finish = result => {
        clearTimeout(timer);
        window.removeEventListener("message", receive);
        resolve(result);
      };
      const receive = event => {
        const message = event.data;
        if (event.source === window && event.origin === location.origin &&
            message?.channel === CHANNEL && message.type === "usage-response" && message.id === id) {
          finish(message.result);
        }
      };
      const timer = setTimeout(() => finish({ ok: false, code: "TIMEOUT" }), 15000);
      window.addEventListener("message", receive);
      window.postMessage({ channel: CHANNEL, type: "usage-request", id }, location.origin);
    }).finally(() => { pending = null; });
    return pending;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || message?.type !== "READ_USAGE") return;
    readUsage().then(sendResponse, () => sendResponse({ ok: false, code: "NETWORK" }));
    return true;
  });
})();
