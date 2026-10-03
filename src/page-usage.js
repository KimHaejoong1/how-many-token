// Runs inside ChatGPT. Authentication never leaves this closure or this origin.
(() => {
  "use strict";
  const ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
  const CHANNEL = "how-many-token/v1";
  const nativeFetch = window.fetch.bind(window);
  let auth = null;
  let revision = 0;
  let inFlight = null;
  let lastResult = null;
  let lastResultAt = 0;

  function observe(url, headers) {
    let target;
    try { target = new URL(url, location.href); } catch { return; }
    if (target.origin !== "https://chatgpt.com") return;
    if (/\/api\/auth\/(?:signout|logout)(?:\/|$)/.test(target.pathname)) {
      auth = null;
      revision++;
      lastResult = null;
      return;
    }
    if (!target.pathname.startsWith("/backend-api/")) return;
    const authorization = headers.get("authorization");
    if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) return;
    // Account-neutral requests must not erase the active workspace selection.
    const accountId = headers.get("chatgpt-account-id") ??
      (auth?.authorization === authorization ? auth.accountId : "");
    if (auth?.authorization !== authorization || auth?.accountId !== accountId) {
      auth = { authorization, accountId };
      revision++;
      lastResult = null;
    }
  }

  window.fetch = function (input, init) {
    // Inspect only the headers of requests the site already makes. Never read bodies.
    try {
      const isRequest = input instanceof Request;
      observe(isRequest ? input.url : String(input),
        new Headers(init?.headers ?? (isRequest ? input.headers : undefined)));
    } catch { /* Observing a request must never break ChatGPT. */ }
    return nativeFetch(input, init);
  };

  // Some site versions use XHR instead of fetch.
  const xhrInfo = new WeakMap();
  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (...args) {
    const result = xhrOpen.apply(this, args);
    xhrInfo.set(this, { url: args[1], headers: new Headers() });
    return result;
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    const result = xhrSetHeader.call(this, name, value);
    try { xhrInfo.get(this)?.headers.append(name, value); } catch { /* No side effects. */ }
    return result;
  };
  XMLHttpRequest.prototype.send = function (...args) {
    try {
      const info = xhrInfo.get(this);
      if (info) observe(info.url, info.headers);
    } catch { /* No side effects. */ }
    return xhrSend.apply(this, args);
  };

  function safeWindow(value) {
    if (!value || typeof value !== "object") return null;
    const result = {};
    for (const key of ["used_percent", "limit_window_seconds", "reset_at", "reset_after_seconds"]) {
      if (typeof value[key] === "number" && Number.isFinite(value[key])) result[key] = value[key];
    }
    return result;
  }

  async function queryUsage() {
    if (!auth) return { ok: false, code: "CONNECT" };
    const generation = revision;
    const headers = { Authorization: auth.authorization };
    if (auth.accountId) headers["ChatGPT-Account-Id"] = auth.accountId;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await nativeFetch(ENDPOINT, {
        method: "GET", headers, credentials: "omit", cache: "no-store",
        redirect: "error", signal: controller.signal
      });
      if (generation !== revision) return { ok: false, code: "ACCOUNT_CHANGED" };
      if (response.status === 401) {
        auth = null;
        revision++;
        return { ok: false, code: "CONNECT" };
      }
      if (response.status === 403) return { ok: false, code: "FORBIDDEN" };
      if (response.status === 429) return { ok: false, code: "RATE_LIMITED" };
      if (!response.ok) return { ok: false, code: "SERVER" };
      const body = await response.json();
      if (generation !== revision) return { ok: false, code: "ACCOUNT_CHANGED" };
      // Whitelist numeric usage fields. Never relay tokens, account IDs, email, or credits.
      const rateLimit = body?.rate_limit;
      return {
        ok: true,
        data: {
          fetchedAt: Date.now(),
          windows: [safeWindow(rateLimit?.primary_window), safeWindow(rateLimit?.secondary_window)].filter(Boolean)
        }
      };
    } catch (error) {
      return { ok: false, code: error?.name === "AbortError" ? "TIMEOUT" : "NETWORK" };
    } finally { clearTimeout(timeout); }
  }

  function readUsage() {
    if (inFlight) return inFlight;
    if (lastResult?.ok && Date.now() - lastResultAt < 2000) return Promise.resolve(lastResult);
    inFlight = queryUsage().then(result => {
      lastResult = result;
      lastResultAt = Date.now();
      return result;
    }).finally(() => { inFlight = null; });
    return inFlight;
  }

  window.addEventListener("message", async event => {
    const message = event.data;
    if (event.source !== window || event.origin !== location.origin ||
        message?.channel !== CHANNEL || message?.type !== "usage-request" ||
        typeof message.id !== "string" || message.id.length > 80) return;
    const result = await readUsage();
    window.postMessage({ channel: CHANNEL, type: "usage-response", id: message.id, result }, location.origin);
  });
})();
