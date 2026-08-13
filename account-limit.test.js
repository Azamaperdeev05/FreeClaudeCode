"use strict";

const assert = require("assert");
const {
  classifyKiroConnection,
  summarizeAccountLimits,
  isBanSignal,
  isQuotaSignal,
} = require("./account-limit");

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

scenario("inactive exhausted rows never sticky-ban a new login", () => {
  const rows = [
    classifyKiroConnection({
      isActive: 0,
      testStatus: "credits_exhausted",
      lastError: "You have reached the limit",
      rateLimitedUntil: new Date(Date.now() + 3600_000).toISOString(),
    }),
    classifyKiroConnection({
      isActive: 1,
      testStatus: "active",
      lastError: null,
      rateLimitedUntil: null,
    }),
  ];
  assert.strictEqual(rows[0].state, "off");
  const s = summarizeAccountLimits(rows);
  assert.strictEqual(s.connected, true);
  assert.strictEqual(s.banned, false);
  assert.strictEqual(s.limited, false);
});

scenario("credits_exhausted is quota, not a ban", () => {
  const row = classifyKiroConnection({
    isActive: 1,
    testStatus: "credits_exhausted",
    lastError: "exceeded their quota",
  });
  assert.strictEqual(row.state, "quota");
  const s = summarizeAccountLimits([row]);
  assert.strictEqual(s.banned, false);
  assert.strictEqual(s.limited, true);
  assert.strictEqual(s.connected, true);
});

scenario("healthy sibling wins over an active limited sibling", () => {
  const now = Date.now();
  const rows = [
    classifyKiroConnection(
      {
        isActive: 1,
        testStatus: "rate_limited",
        rateLimitedUntil: new Date(now + 2 * 3600_000).toISOString(),
      },
      now
    ),
    classifyKiroConnection({ isActive: 1, testStatus: "active" }, now),
  ];
  const s = summarizeAccountLimits(rows);
  assert.strictEqual(s.limited, false);
  assert.strictEqual(s.banned, false);
  assert.strictEqual(s.connected, true);
});

scenario("only long cooldown locks the UI", () => {
  const now = Date.now();
  const short = classifyKiroConnection(
    {
      isActive: 1,
      testStatus: "active",
      rateLimitedUntil: new Date(now + 20_000).toISOString(),
    },
    now
  );
  assert.strictEqual(short.state, "limited");
  assert.strictEqual(summarizeAccountLimits([short]).limited, false);

  const long = classifyKiroConnection(
    {
      isActive: 1,
      testStatus: "active",
      rateLimitedUntil: new Date(now + 2 * 3600_000).toISOString(),
    },
    now
  );
  assert.strictEqual(summarizeAccountLimits([long]).limited, true);
});

scenario("real ban only when nothing else is usable", () => {
  const row = classifyKiroConnection({
    isActive: 1,
    testStatus: "banned",
    lastError: "Your account has been suspended as a security precaution",
  });
  assert.strictEqual(row.state, "banned");
  const s = summarizeAccountLimits([row]);
  assert.strictEqual(s.banned, true);
  assert.strictEqual(s.limited, false);
  assert.strictEqual(s.connected, false);
});

scenario("402-style limit text is quota, not ban", () => {
  assert.strictEqual(isQuotaSignal("active", "API Error: 402 You have reached the limit"), true);
  assert.strictEqual(isBanSignal("active", "API Error: 402 You have reached the limit"), false);
});

process.exit(failed ? 1 : 0);
