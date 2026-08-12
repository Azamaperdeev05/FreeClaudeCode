const assert = require("assert");
const { pickKiroRows, kiroStateFromProviders } = require("./kiro-state");

let failed = 0;
function scenario(name, fn) {
  try {
    fn();
    console.log("ok  ", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, "\n    ", err.message);
  }
}

scenario("a live account reads as connected", () => {
  const state = kiroStateFromProviders([
    { provider: "kiro", isActive: true, testStatus: "active" },
  ]);
  assert.deepStrictEqual(state, { total: 1, active: 1, connected: true, banned: false });
});

scenario("expired accounts alongside one live account still count as connected", () => {
  // The real shape after a few days of use: many dead rows, one good one.
  const rows = Array.from({ length: 17 }, () => ({
    provider: "kiro",
    isActive: false,
    testStatus: "error",
    lastError: "Refresh token expired. Please re-authenticate this account.",
  }));
  rows.push({ provider: "kiro", isActive: true, testStatus: "active" });
  const state = kiroStateFromProviders(rows);
  assert.strictEqual(state.total, 18);
  assert.strictEqual(state.active, 1);
  assert.strictEqual(state.connected, true);
});

scenario("only inactive accounts means not connected", () => {
  const state = kiroStateFromProviders([
    { provider: "kiro", isActive: false, testStatus: "error" },
    { provider: "kiro", isActive: false, testStatus: "disconnected" },
  ]);
  assert.strictEqual(state.connected, false);
  assert.strictEqual(state.banned, false);
});

scenario("an active-but-banned account does not count as connected", () => {
  const state = kiroStateFromProviders([
    { provider: "kiro", isActive: true, testStatus: "banned" },
  ]);
  assert.strictEqual(state.connected, false);
  assert.strictEqual(state.banned, true);
});

scenario("expired and credits_exhausted are terminal but are not a ban", () => {
  const state = kiroStateFromProviders([
    { provider: "kiro", isActive: true, testStatus: "expired" },
    { provider: "kiro", isActive: true, testStatus: "credits_exhausted" },
  ]);
  assert.strictEqual(state.connected, false);
  assert.strictEqual(state.banned, false);
});

scenario("snake_case rows from an older build are understood", () => {
  const state = kiroStateFromProviders([
    { provider: "kiro", is_active: 1, test_status: "active" },
  ]);
  assert.strictEqual(state.connected, true);
});

scenario("numeric and string truthiness both work", () => {
  assert.strictEqual(kiroStateFromProviders([{ provider: "kiro", isActive: 1 }]).connected, true);
  assert.strictEqual(kiroStateFromProviders([{ provider: "kiro", isActive: "1" }]).connected, true);
  assert.strictEqual(kiroStateFromProviders([{ provider: "kiro", isActive: "0" }]).connected, false);
});

scenario("an unknown status is not treated as terminal", () => {
  const state = kiroStateFromProviders([
    { provider: "kiro", isActive: true, testStatus: "rate_limited" },
  ]);
  assert.strictEqual(state.connected, true);
});

scenario("other providers are ignored", () => {
  const rows = pickKiroRows([
    { provider: "openai", isActive: true },
    { provider: "anthropic", isActive: true },
    { provider: "kr", isActive: true },
  ]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].provider, "kr");
});

scenario("every envelope shape OmniRoute has used is unwrapped", () => {
  const row = { provider: "kiro", isActive: true, testStatus: "active" };
  for (const payload of [[row], { providers: [row] }, { connections: [row] }, { data: [row] }]) {
    assert.strictEqual(kiroStateFromProviders(payload).connected, true, JSON.stringify(payload));
  }
});

scenario("junk payloads report not connected instead of throwing", () => {
  for (const payload of [null, undefined, {}, "nope", { providers: null }]) {
    assert.strictEqual(kiroStateFromProviders(payload).connected, false);
  }
});

scenario("no kiro accounts at all", () => {
  const state = kiroStateFromProviders([{ provider: "openai", isActive: true }]);
  assert.deepStrictEqual(state, { total: 0, active: 0, connected: false, banned: false });
});

process.exit(failed ? 1 : 0);
