"use strict";

const { t } = require("./i18n");

/**
 * OmniRoute and Kiro answer in raw English ("All kiro accounts have exhausted their…"),
 * which does not tell a user whether they are rate limited, banned, logged out or simply
 * offline. Each rule turns one of those into a `kind`; the wording for that kind lives in
 * the shared dictionary as `err.<kind>.title` / `err.<kind>.hint`.
 *
 * Order matters: the specific cases sit above the generic status-code fallbacks.
 */
const RULES = [
  {
    kind: "quota",
    match: (status, text) => /exhausted|quota (?:exceeded|exhausted)|out of (?:credits|quota)/i.test(text),
  },
  {
    kind: "banned",
    match: (status, text) => /suspend|banned|locked your account|security precaution|account disabled/i.test(text),
  },
  {
    kind: "session",
    match: (status, text) =>
      /token (?:has )?expired|refresh token|reauthenticate|re-?login|invalid_grant|session expired/i.test(text),
  },
  {
    kind: "no-account",
    match: (status, text) => /no (?:kiro )?(?:accounts?|connections?|providers?) (?:available|configured|found)/i.test(text),
  },
  {
    kind: "key",
    match: (status, text) =>
      status === 401 || /invalid api key|unauthorized|authentication|x-api-key|invalid token/i.test(text),
  },
  {
    kind: "model",
    // OmniRoute answers "[400]: Invalid model. Please select a different model to continue."
    match: (status, text) =>
      status === 404 ||
      /invalid model|unknown model|unsupported model|no such model|model (?:not found|not supported|unavailable|does not exist)/i.test(
        text
      ),
  },
  {
    kind: "context",
    match: (status, text) => /context (?:length|window)|too many tokens|prompt is too long|max_tokens/i.test(text),
  },
  {
    kind: "busy",
    match: (status, text) => status === 529 || /overloaded|server is busy|capacity/i.test(text),
  },
  {
    kind: "offline",
    match: (status, text) =>
      /econnrefused|fetch failed|socket hang up|econnreset|enotfound|network|failed to fetch/i.test(text),
  },
  {
    kind: "timeout",
    match: (status, text) => /timeout|timed out|etimedout|aborted/i.test(text),
  },
  { kind: "rate", match: (status) => status === 429 },
  { kind: "forbidden", match: (status) => status === 403 },
  { kind: "upstream", match: (status) => status >= 500 },
  {
    kind: "request",
    match: (status, text) => status === 400 || /invalid_request_error|bad_request|is required/i.test(text),
  },
];

/** The rule that fired, without any wording attached. */
function classifyUpstreamError(status, rawError) {
  const code = Number.isFinite(Number(status)) ? Number(status) : null;
  const raw = String(rawError == null ? "" : rawError).trim();
  for (const rule of RULES) {
    if (rule.match(code ?? 0, raw)) return { kind: rule.kind, raw, status: code };
  }
  return { kind: raw ? "unknown" : "empty", raw, status: code };
}

/**
 * @returns {{kind: string, title: string, hint: string, raw: string, status: number|null}}
 *   `kind` travels to the browser so the UI can re-word the same failure when the user
 *   flips the language without the request being replayed.
 */
function describeUpstreamError(status, rawError, lang) {
  const { kind, raw, status: code } = classifyUpstreamError(status, rawError);
  return {
    kind,
    title: t(lang, `err.${kind}.title`),
    hint: t(lang, `err.${kind}.hint`),
    raw,
    status: code,
  };
}

/** One line for toasts and card captions. */
function shortReason(reason, lang) {
  if (!reason) return t(lang, "toast.error");
  return reason.status ? `${reason.status} · ${reason.title}` : reason.title;
}

module.exports = { classifyUpstreamError, describeUpstreamError, shortReason };
