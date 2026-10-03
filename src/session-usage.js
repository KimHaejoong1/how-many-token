import { normalizeUsage } from "./usage.js";

const SESSION_URL = "https://chatgpt.com/api/auth/session";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

class UsageError extends Error {}

async function readJson(fetcher, url, credentials, signal, headers = {}) {
  const response = await fetcher(url, {
    method: "GET", credentials, headers, signal, cache: "no-store", redirect: "error"
  });
  if (response.status === 401) throw new UsageError("LOGIN_REQUIRED");
  if (response.status === 403) throw new UsageError("DIRECT_BLOCKED");
  if (response.status === 429) throw new UsageError("RATE_LIMITED");
  if (!response.ok) throw new UsageError("SERVER");
  if (response.headers.get("content-type")?.includes("text/html")) throw new UsageError("DIRECT_BLOCKED");
  try { return await response.json(); }
  catch (error) {
    if (error instanceof SyntaxError) throw new UsageError("UNSUPPORTED");
    throw error;
  }
}

async function readSession(fetcher, signal) {
  // Chrome sends the existing login cookie to ChatGPT. Never read or store cookies.
  const session = await readJson(fetcher, SESSION_URL, "include", signal);
  const token = session?.accessToken;
  if (typeof token !== "string" || !token) throw new UsageError("LOGIN_REQUIRED");
  if (token.length > 16384 || /\s/.test(token)) throw new UsageError("UNSUPPORTED");
  if (session.expires && Date.parse(session.expires) <= Date.now()) throw new UsageError("LOGIN_REQUIRED");
  const accountId = session.account?.id ?? "";
  if (typeof accountId !== "string" || (accountId && !/^[A-Za-z0-9_-]{1,200}$/.test(accountId))) {
    throw new UsageError("UNSUPPORTED");
  }
  const userId = typeof session.user?.id === "string" ? session.user.id : "";
  // Stable IDs allow normal token rotation; otherwise compare the token conservatively.
  const identity = JSON.stringify([userId, accountId, userId || accountId ? "" : token]);
  return { token, accountId, identity };
}

export async function readSessionUsage(fetcher = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const session = await readSession(fetcher, controller.signal);
    const headers = { Authorization: `Bearer ${session.token}` };
    if (session.accountId) headers["ChatGPT-Account-Id"] = session.accountId;
    const body = await readJson(fetcher, USAGE_URL, "omit", controller.signal, headers);
    let usage;
    try {
      usage = normalizeUsage({
        fetchedAt: Date.now(),
        windows: [body?.rate_limit?.primary_window, body?.rate_limit?.secondary_window]
      });
    } catch { throw new UsageError("UNSUPPORTED"); }
    // Do not publish the old account's usage after logout or an account switch.
    const currentSession = await readSession(fetcher, controller.signal);
    if (session.identity !== currentSession.identity) throw new UsageError("ACCOUNT_CHANGED");
    // Only normalized numbers leave this request. No token, identity, or response is cached.
    return { ok: true, usage };
  } catch (error) {
    return {
      ok: false,
      code: controller.signal.aborted || error?.name === "AbortError" ? "TIMEOUT"
        : error instanceof UsageError ? error.message : "NETWORK"
    };
  } finally { clearTimeout(timeout); }
}
