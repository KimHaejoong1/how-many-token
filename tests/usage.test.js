import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUsage, resetText, usageColor, WEEK_SECONDS } from "../src/usage.js";

const weekly = { used_percent: 21, limit_window_seconds: WEEK_SECONDS, reset_at: 1791114146 };
test("weekly window can be the primary or secondary window", () => {
  for (const windows of [[weekly], [{ used_percent: 5, limit_window_seconds: 18000 }, weekly]]) {
    assert.deepEqual(normalizeUsage({ windows, fetchedAt: 1000 }), {
      remainingPercent: 79, resetAt: 1791114146000, fetchedAt: 1000
    });
  }
});
test("unknown or missing usage is never displayed as a full allowance", () => {
  for (const data of [{}, { windows: [] }, { windows: [{ ...weekly, used_percent: null }] },
    { windows: [{ ...weekly, used_percent: 101 }] }, { windows: [{ ...weekly, reset_at: undefined }] },
    { windows: [{ ...weekly, limit_window_seconds: 18000 }] }]) {
    assert.throws(() => normalizeUsage(data), /UNSUPPORTED/);
  }
});
test("reset duration is anchored to the response timestamp", () => {
  const result = normalizeUsage({ fetchedAt: 10000, windows: [{ ...weekly, reset_at: undefined, reset_after_seconds: 90 }] }, 50000);
  assert.equal(result.resetAt, 100000);
});
test("empty and full allowances retain their exact meaning", () => {
  assert.equal(normalizeUsage({ windows: [{ ...weekly, used_percent: 100 }] }).remainingPercent, 0);
  assert.equal(normalizeUsage({ windows: [{ ...weekly, used_percent: 0 }] }).remainingPercent, 100);
});
test("countdown handles days, the final minute, and passed reset times", () => {
  assert.equal(resetText(180000000, 0), "초기화까지 2일 2시간 남았습니다");
  assert.equal(resetText(60001, 0), "초기화까지 2분 남았습니다");
  assert.equal(resetText(1, 0), "초기화까지 1분 남았습니다");
  assert.match(resetText(0, 0), /초기화 시각이 지났습니다/);
});
test("remaining allowance sets red, yellow, and lime endpoints", () => {
  assert.equal(usageColor(0), "rgb(239, 68, 68)");
  assert.equal(usageColor(50), "rgb(234, 179, 8)");
  assert.equal(usageColor(100), "rgb(132, 204, 22)");
});
