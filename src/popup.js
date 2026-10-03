import { ERRORS, isUsage, resetText, usageColor } from "./usage.js";

const ui = Object.fromEntries(["refresh", "reset", "remaining", "progress", "fill", "notice", "error", "connect", "status"]
  .map(id => [id, document.getElementById(id)]));
const main = document.querySelector("main");
let current = null;
let busy = false;
let lastAttempt = 0;
let resetRefreshFor = null;

function renderUsage() {
  if (!current) return;
  const percent = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 }).format(current.remainingPercent);
  ui.remaining.textContent = `${percent}% 남음`;
  ui.reset.textContent = resetText(current.resetAt);
  ui.reset.title = `초기화: ${new Date(current.resetAt).toLocaleString("ko-KR")}\n마지막 조회: ${new Date(current.fetchedAt).toLocaleString("ko-KR")}`;
  ui.progress.setAttribute("aria-valuenow", String(current.remainingPercent));
  ui.progress.setAttribute("aria-valuetext", `${percent}% 남음`);
  ui.fill.style.width = `${current.remainingPercent}%`;
  ui.fill.style.backgroundColor = usageColor(current.remainingPercent);
}

function showError(code) {
  current = null;
  ui.remaining.textContent = "—";
  ui.reset.textContent = "사용량을 확인할 수 없어요";
  ui.reset.removeAttribute("title");
  ui.progress.removeAttribute("aria-valuenow");
  ui.progress.setAttribute("aria-valuetext", "사용량 확인 필요");
  ui.fill.style.width = "0%";
  ui.notice.hidden = false;
  ui.error.textContent = ERRORS[code] || ERRORS.NETWORK;
  ui.connect.hidden = !["NO_TAB", "CONNECT", "RELOAD", "FORBIDDEN", "UNSUPPORTED", "LOGIN_REQUIRED", "DIRECT_BLOCKED"].includes(code);
  ui.status.textContent = ui.error.textContent;
}

async function refresh() {
  if (busy) return;
  busy = true;
  lastAttempt = Date.now();
  main.setAttribute("aria-busy", "true");
  ui.refresh.disabled = true;
  ui.notice.hidden = true;
  if (!current) ui.reset.textContent = "사용량을 확인하고 있어요";
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_USAGE" });
    if (response?.ok && isUsage(response.usage)) {
      current = response.usage;
      renderUsage();
      ui.status.textContent = `${ui.remaining.textContent}. ${ui.reset.textContent}`;
    } else showError(response?.code || "UNSUPPORTED");
  } catch { showError("NETWORK"); }
  finally {
    busy = false;
    main.setAttribute("aria-busy", "false");
    ui.refresh.disabled = false;
  }
}

ui.refresh.addEventListener("click", refresh);
ui.connect.addEventListener("click", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: "OPEN_CHATGPT" });
    if (response?.ok) window.close();
    else showError("NETWORK");
  } catch { showError("NETWORK"); }
});

// Nothing polls while the popup is closed. The countdown needs no network request.
setInterval(() => {
  if (!current || document.hidden) return;
  renderUsage();
  if (current.resetAt <= Date.now() && resetRefreshFor !== current.resetAt) {
    resetRefreshFor = current.resetAt;
    refresh();
  }
}, 1000);
setInterval(() => {
  if (!document.hidden && Date.now() - lastAttempt >= 60000) refresh();
}, 60000);
refresh();
