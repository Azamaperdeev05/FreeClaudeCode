const assert = require("assert");
const { describeUpstreamError, shortReason } = require("./errors");

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e.message}`);
  }
}

const cases = [
  // The exact message a user reported from the model probe.
  [429, "[kiro/claude-sonnet-4.5] All kiro accounts have exhausted their quota", "quota"],
  [429, "Rate limit reached, slow down", "rate"],
  [403, "Your account has been suspended as a security precaution", "banned"],
  [403, "We locked your account", "banned"],
  [401, "invalid api key provided", "key"],
  [401, "", "key"],
  [400, "invalid_grant: refresh token is invalid", "session"],
  [400, "Kiro token has expired, please reauthenticate", "session"],
  [400, "No kiro accounts available", "no-account"],
  [404, "model kiro/foo not found", "model"],
  // Verbatim from a live OmniRoute when the model id is wrong.
  [400, "[400]: Invalid model. Please select a different model to continue.", "model"],
  [400, "messages: at least one message is required", "request"],
  [400, "prompt is too long: 250000 tokens", "context"],
  [529, "Overloaded", "busy"],
  [503, "upstream capacity exceeded", "busy"],
  [500, "internal server error", "upstream"],
  [null, "fetch failed: ECONNREFUSED 127.0.0.1:20128", "offline"],
  [null, "The operation was aborted due to timeout", "timeout"],
  [403, "something we never saw", "forbidden"],
  [200, "totally unrecognised text", "unknown"],
  [200, "", "empty"],
];

for (const [status, text, kind] of cases) {
  check(`${status ?? "-"} ${JSON.stringify(text).slice(0, 44)} -> ${kind}`, () => {
    const r = describeUpstreamError(status, text);
    assert.strictEqual(r.kind, kind, `got ${r.kind} (${r.title})`);
    assert.ok(r.title && r.hint, "title and hint present");
    assert.strictEqual(r.raw, String(text || "").trim(), "raw preserved for support");
  });
}

check("quota beats the generic 429 fallback", () => {
  const r = describeUpstreamError(429, "All kiro accounts have exhausted their limits");
  assert.strictEqual(r.kind, "quota");
  assert.match(r.hint, /account/i);
});

check("ban beats the generic 403 fallback", () => {
  assert.strictEqual(describeUpstreamError(403, "account suspended").kind, "banned");
});

check("wording follows the chosen language, the kind does not", () => {
  const en = describeUpstreamError(429, "exhausted", "en");
  const ru = describeUpstreamError(429, "exhausted", "ru");
  assert.strictEqual(en.kind, ru.kind);
  assert.notStrictEqual(en.title, ru.title);
  assert.match(ru.title, /[А-Яа-яЁё]/);
  assert.doesNotMatch(en.title, /[А-Яа-яЁё]/);
});

check("English is used when no language is given", () => {
  assert.strictEqual(describeUpstreamError(429, "exhausted").title, describeUpstreamError(429, "exhausted", "en").title);
});

check("short reason keeps the status code", () => {
  assert.strictEqual(
    shortReason(describeUpstreamError(429, "exhausted", "ru"), "ru"),
    "429 · Лимит Kiro исчерпан на всех аккаунтах"
  );
  assert.strictEqual(shortReason(describeUpstreamError(null, "fetch failed", "en"), "en"), "No connection to OmniRoute");
  assert.strictEqual(shortReason(null, "ru"), "Ошибка");
  assert.strictEqual(shortReason(null, "en"), "Error");
});

check("empty error still explains itself", () => {
  const r = describeUpstreamError(null, "");
  assert.strictEqual(r.kind, "empty");
  assert.ok(r.title.length > 0 && r.hint.length > 0);
});

process.exit(failed ? 1 : 0);
