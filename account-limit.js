"use strict";

/**
 * Pure helpers for FreeClaude's Kiro limit / ban banner.
 *
 * OmniRoute keeps every past Builder ID as a `provider_connections` row. A dead
 * row with `credits_exhausted` or a leftover `rate_limited_until` used to paint
 * the whole UI as banned even after the user signed into a fresh account.
 */

const MIN_LIMIT_MS = 60 * 1000;

/** Real AWS lock — not quota exhaustion, not a cooldown. */
function isBanSignal(testStatus, lastError) {
  const status = String(testStatus || "").trim().toLowerCase();
  if (status === "banned") return true;
  return /suspend|banned|locked your account|security precaution|account disabled/i.test(
    String(lastError || "")
  );
}

function isQuotaSignal(testStatus, lastError) {
  const status = String(testStatus || "").trim().toLowerCase();
  if (status === "credits_exhausted") return true;
  return /exhausted|quota (?:exceeded|exhausted)|out of (?:credits|quota)|reached the limit/i.test(
    String(lastError || "")
  );
}

/**
 * Classify one Kiro connection the way the UI understands it.
 * Inactive rows are always `off` so they cannot sticky-ban a new login.
 */
function classifyKiroConnection(row, now = Date.now()) {
  const isActive = row?.isActive === true || row?.isActive === 1 || row?.isActive === "1";
  const testStatus = String(row?.testStatus ?? row?.test_status ?? "").trim().toLowerCase();
  const lastError = row?.lastError ?? row?.last_error ? String(row.lastError ?? row.last_error) : "";
  const rateRaw = row?.rateLimitedUntil ?? row?.rate_limited_until ?? null;
  const rateUntil = rateRaw ? new Date(rateRaw).getTime() : null;
  const cooling = Boolean(rateUntil && rateUntil > now);
  const coolLeftMs = cooling ? Math.max(0, rateUntil - now) : 0;

  let state = "ok";
  let detail = "активен";

  if (!isActive || testStatus === "disconnected") {
    state = "off";
    detail = "выключен";
  } else if (isBanSignal(testStatus, lastError)) {
    state = "banned";
    detail = lastError || testStatus || "аккаунт заблокирован";
  } else if (isQuotaSignal(testStatus, lastError)) {
    state = "quota";
    detail = lastError || testStatus || "квота исчерпана";
  } else if (testStatus === "expired") {
    state = "expired";
    detail = lastError || "сессия истекла";
  } else if (cooling || testStatus === "rate_limited") {
    state = "limited";
    detail = coolLeftMs > 0 ? `лимит · ещё ${coolLeftMs}ms` : "rate_limited";
  } else if (testStatus && testStatus !== "active") {
    state = "warn";
    detail = testStatus;
  } else if (lastError) {
    state = "warn";
    detail = lastError.slice(0, 120);
  }

  return {
    isActive: Boolean(isActive),
    state,
    detail,
    testStatus,
    cooling,
    coolLeftMs,
    rateLimitedUntil: rateRaw || null,
    lastError: lastError || null,
  };
}

/**
 * Banner / lock flags from already-classified rows.
 * A healthy active account always wins over exhausted siblings.
 */
function summarizeAccountLimits(kiro, { minLimitMs = MIN_LIMIT_MS } = {}) {
  const rows = Array.isArray(kiro) ? kiro : [];
  const active = rows.filter((k) => k.isActive && k.state !== "off");

  const seriousLimited = (k) =>
    k.state === "quota" ||
    k.state === "limited" ||
    (Boolean(k.cooling) && Number(k.coolLeftMs || 0) >= minLimitMs);

  const usable = active.filter((k) => {
    if (k.state === "banned" || k.state === "expired") return false;
    if (seriousLimited(k) && Number(k.coolLeftMs || 0) >= minLimitMs) return false;
    if (k.state === "quota") return false;
    return true;
  });

  const limitedCandidates = active.filter(seriousLimited);
  const bannedCandidates = active.filter((k) => k.state === "banned");

  let banned = false;
  let limited = false;
  let limitedRow = null;
  let banReason = null;

  if (usable.length === 0) {
    if (limitedCandidates.length) {
      limited = true;
      limitedRow = limitedCandidates.reduce((best, row) => {
        const left = Number(row.coolLeftMs || 0);
        const bestLeft = Number(best?.coolLeftMs || 0);
        return left >= bestLeft ? row : best;
      }, limitedCandidates[0]);
    } else if (bannedCandidates.length) {
      banned = true;
      banReason = bannedCandidates[0].lastError || bannedCandidates[0].detail || null;
    }
  }

  // Logged in even while cooling / quota — auth buttons stay useful.
  const connected = active.some((k) => k.state !== "banned" && k.state !== "expired");

  let resetAt = null;
  if (limitedRow?.rateLimitedUntil) {
    const t = new Date(limitedRow.rateLimitedUntil).getTime();
    if (!Number.isNaN(t)) resetAt = t;
  }
  const resetInMs = resetAt
    ? Math.max(0, resetAt - Date.now())
    : limitedRow
      ? Number(limitedRow.coolLeftMs || 0)
      : 0;

  return {
    connected,
    banned,
    banReason,
    limited,
    resetAt,
    resetInMs,
    limitedRow: limitedRow || null,
  };
}

module.exports = {
  MIN_LIMIT_MS,
  isBanSignal,
  isQuotaSignal,
  classifyKiroConnection,
  summarizeAccountLimits,
};
