export const WEEK_SECONDS = 7 * 24 * 60 * 60;

export function normalizeUsage(data, now = Date.now()) {
  const weekly = data?.windows?.find(window => window?.limit_window_seconds === WEEK_SECONDS);
  if (!weekly || !Number.isFinite(weekly.used_percent) || weekly.used_percent < 0 || weekly.used_percent > 100) {
    throw new Error("UNSUPPORTED");
  }
  const fetchedAt = Number.isFinite(data.fetchedAt) ? data.fetchedAt : now;
  const resetAt = Number.isFinite(weekly.reset_at) && weekly.reset_at > 0
    ? weekly.reset_at * 1000
    : Number.isFinite(weekly.reset_after_seconds) && weekly.reset_after_seconds >= 0
      ? fetchedAt + weekly.reset_after_seconds * 1000 : NaN;
  if (!Number.isFinite(resetAt)) throw new Error("UNSUPPORTED");
  return { remainingPercent: 100 - weekly.used_percent, resetAt, fetchedAt };
}

export function isUsage(value) {
  return value && Number.isFinite(value.remainingPercent) && value.remainingPercent >= 0 &&
    value.remainingPercent <= 100 && Number.isFinite(value.resetAt) && value.resetAt > 0 &&
    Number.isFinite(value.fetchedAt) && value.fetchedAt > 0;
}

export function resetText(resetAt, now = Date.now()) {
  const ms = resetAt - now;
  if (ms <= 0) return "초기화 시각이 지났습니다 · 새로고침해 주세요";
  const minutes = Math.ceil(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const parts = days ? [`${days}일`, `${hours}시간`] : hours ? [`${hours}시간`, `${rest}분`] : [`${rest}분`];
  return `초기화까지 ${parts.join(" ")} 남았습니다`;
}

export function usageColor(percent) {
  // A single fill color changes continuously: red → yellow → lime.
  const p = Math.min(100, Math.max(0, percent));
  const stops = [[239, 68, 68], [234, 179, 8], [132, 204, 22]];
  const index = p <= 50 ? 0 : 1;
  const t = index === 0 ? p / 50 : (p - 50) / 50;
  return `rgb(${stops[index].map((v, i) => Math.round(v + (stops[index + 1][i] - v) * t)).join(", ")})`;
}

export const ERRORS = {
  LOGIN_REQUIRED: "ChatGPT에 한 번 로그인해 주세요. 로그인 후에는 탭을 닫아도 됩니다.",
  DIRECT_BLOCKED: "탭 없이 연결하지 못했어요. ChatGPT를 열어 로그인 상태를 확인해 주세요.",
  NO_TAB: "ChatGPT 탭을 하나 열어 주세요. 로그인된 탭이 있으면 바로 확인할 수 있어요.",
  CONNECT: "ChatGPT에 로그인한 뒤 탭을 한 번 새로고침해 주세요.",
  RELOAD: "확장프로그램을 연결하려면 열려 있는 ChatGPT 탭을 한 번 새로고침해 주세요.",
  TIMEOUT: "조회가 지연되고 있어요. 잠시 후 다시 눌러 주세요.",
  NETWORK: "사용량을 가져오지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.",
  FORBIDDEN: "ChatGPT 탭에서 정상적으로 접속되는지 확인한 뒤 새로고침해 주세요.",
  RATE_LIMITED: "조회 요청이 많아요. 잠시 후 다시 눌러 주세요.",
  SERVER: "ChatGPT에서 사용량을 불러오지 못했어요. 잠시 후 다시 눌러 주세요.",
  ACCOUNT_CHANGED: "계정이 변경됐어요. 다시 새로고침해 주세요.",
  UNSUPPORTED: "이 계정의 주간 사용 한도를 확인할 수 없어요. ChatGPT 사용량 화면을 확인해 주세요."
};
