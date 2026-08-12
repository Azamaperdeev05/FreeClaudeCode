/**
 * Reading the Kiro account state out of OmniRoute's `/api/providers` response.
 *
 * This exists as a fallback for the SQLite path: the database is read through a child
 * Node process, and on machines where that fails (no Node on PATH, unusable
 * better-sqlite3 binary, locked file) FreeClaude used to report the user as logged out
 * moments after a successful AWS login. OmniRoute's own API always knows the truth.
 */

/** OmniRoute has shipped several envelope shapes for this endpoint. */
function pickKiroRows(payload) {
  const list = Array.isArray(payload)
    ? payload
    : payload?.providers || payload?.connections || payload?.data || [];
  if (!Array.isArray(list)) return [];
  return list.filter((c) => /^(kiro|kr)$/i.test(String(c?.provider || "")));
}

/** Statuses no amount of retrying will fix — the account needs replacing. */
const TERMINAL = new Set(["banned", "expired", "credits_exhausted"]);

function readFlag(row, camel, snake) {
  const v = row?.[camel] ?? row?.[snake];
  return v === true || v === 1 || v === "1";
}

function readStatus(row) {
  return String(row?.testStatus ?? row?.test_status ?? "").trim().toLowerCase();
}

/**
 * `connected` means at least one Kiro account OmniRoute is willing to route through.
 * An account in a terminal state never counts, even when it is still flagged active.
 */
function summarizeKiro(rows) {
  let connected = false;
  let banned = false;
  let active = 0;
  for (const row of rows) {
    const status = readStatus(row);
    if (TERMINAL.has(status)) {
      if (status === "banned") banned = true;
      continue;
    }
    if (readFlag(row, "isActive", "is_active")) {
      active += 1;
      connected = true;
    }
  }
  return { total: rows.length, active, connected, banned };
}

function kiroStateFromProviders(payload) {
  return summarizeKiro(pickKiroRows(payload));
}

module.exports = { pickKiroRows, summarizeKiro, kiroStateFromProviders, TERMINAL };
