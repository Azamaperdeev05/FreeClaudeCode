const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const formatDuration = require("./format-duration");
const omniDoctor = require("./omni-doctor");
const {
  MIN_LIMIT_MS,
  classifyKiroConnection,
  summarizeAccountLimits,
} = require("./account-limit");

// OmniRoute writes to this same file, so reads/writes can collide.
const BUSY_TIMEOUT_MS = 10000;

/**
 * Mirrors OmniRoute's own resolver (src/lib/dataPaths.ts): DATA_DIR wins, then the
 * legacy ~/.omniroute directory if it still exists, then %APPDATA%/omniroute.
 * A fresh install has no legacy directory, so hardcoding it loses the database.
 */
function candidateDbPaths() {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const dirs = [];

  const configured = String(process.env.DATA_DIR || "").trim();
  if (configured) dirs.push(path.resolve(configured));

  if (home) dirs.push(path.join(home, ".omniroute"));

  const appData = process.env.APPDATA || (home ? path.join(home, "AppData", "Roaming") : "");
  if (appData) dirs.push(path.join(appData, "omniroute"));

  const seen = new Set();
  return dirs
    .filter((dir) => {
      const norm = dir.toLowerCase();
      if (seen.has(norm)) return false;
      seen.add(norm);
      return true;
    })
    .map((dir) => path.join(dir, "storage.sqlite"));
}

function resolveDbPath() {
  const candidates = candidateDbPaths();
  return candidates.find((file) => fs.existsSync(file)) || candidates[candidates.length - 1] || "";
}

let _Database;

function loadDatabaseCtor() {
  if (_Database) return _Database;

  // Our own copy is built against the Node that runs this file. OmniRoute's copy is
  // compiled for whatever runtime OmniRoute uses, so it is only a last resort.
  const candidates = [
    path.join(__dirname, "node_modules", "better-sqlite3"),
    path.join(path.dirname(process.execPath || ""), "node_modules", "better-sqlite3"),
    path.join(path.dirname(process.execPath || ""), "better-sqlite3"),
    "better-sqlite3",
    path.join(process.env.APPDATA || "", "npm", "node_modules", "omniroute", "node_modules", "better-sqlite3"),
  ];

  let lastErr = null;
  for (const mod of candidates) {
    try {
      _Database = require(mod);
      return _Database;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    "Не найден better-sqlite3 (установи OmniRoute). " + String(lastErr?.message || lastErr || "")
  );
}

function getDb(readonly = false) {
  const Database = loadDatabaseCtor();
  const file = resolveDbPath();
  if (!file || !fs.existsSync(file)) {
    throw new Error(
      `OmniRoute DB не найдена (искали: ${candidateDbPaths().join(", ")}). Сначала установи и запусти OmniRoute.`
    );
  }
  return new Database(file, { readonly, timeout: BUSY_TIMEOUT_MS });
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function buildSelectColumns(db, table, mapping) {
  const cols = new Set(tableColumns(db, table));
  const parts = [];
  for (const [col, alias] of Object.entries(mapping)) {
    if (cols.has(col)) parts.push(`${col} as ${alias}`);
  }
  return parts.join(", ") || "*";
}

function buildUpdateSet(db, table, assignments) {
  const cols = new Set(tableColumns(db, table));
  const parts = [];
  const values = [];
  for (const [col, value] of Object.entries(assignments)) {
    if (cols.has(col)) {
      parts.push(`${col} = ?`);
      values.push(value);
    }
  }
  if (!parts.length) throw new Error(`В таблице ${table} нет ни одной из ожидаемых колонок`);
  return { set: parts.join(", "), values };
}

function machineIdFromExisting(db) {
  try {
    const row = db.prepare("SELECT machine_id FROM api_keys WHERE machine_id IS NOT NULL LIMIT 1").get();
    if (row?.machine_id) return row.machine_id;
  } catch {
    /* ignore */
  }
  return crypto.createHash("sha256").update(process.env.COMPUTERNAME || "pc").digest("hex").slice(0, 16);
}

function insertApiKey(db, name) {
  const cols = new Set(tableColumns(db, "api_keys"));
  if (!cols.has("key") || !cols.has("name") || !cols.has("id")) {
    throw new Error("Таблица api_keys в OmniRoute повреждена или слишком старая");
  }

  const machine = machineIdFromExisting(db);
  const key = `sk-${machine}-${crypto.randomBytes(3).toString("hex")}-${crypto.randomBytes(4).toString("hex")}`;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const keyHash = crypto.createHash("sha256").update(key).digest("hex");
  const keyPrefix = key.slice(0, Math.min(11, key.length));

  // Только колонки, которые реально есть в этой версии OmniRoute
  const row = {
    id,
    name,
    key,
    machine_id: machine,
    allowed_models: "[]",
    no_log: 0,
    created_at: now,
    key_prefix: keyPrefix,
    scopes: JSON.stringify(["self:usage"]),
    stream_default_mode: "legacy",
    allowed_quotas: "[]",
    disable_non_public_models: 0,
    usage_limit_enabled: 0,
    blocked_models: null,
    auto_resolve: 0,
    is_active: 1,
    max_sessions: 0,
    is_banned: 0,
    key_hash: keyHash,
    allow_usage_command: 0,
    chaos_mode_enabled: 0,
  };

  const useCols = Object.keys(row).filter((c) => cols.has(c));
  const placeholders = useCols.map(() => "?").join(", ");
  db.prepare(`INSERT INTO api_keys (${useCols.join(", ")}) VALUES (${placeholders})`).run(
    ...useCols.map((c) => row[c])
  );

  return {
    id,
    name,
    key,
    createdAt: now,
    expiresAt: null,
    masked: `${key.slice(0, 6)}…${key.slice(-4)}`,
  };
}

function createApiKey(name = "freeclaude") {
  const db = getDb(false);
  try {
    return insertApiKey(db, name);
  } finally {
    db.close();
  }
}

/**
 * Есть активный ключ — вернём его; нет — создадим.
 * Look-up and insert share one transaction so two quick calls cannot both decide
 * that no key exists and each create one.
 */
function ensureApiKey(name = "freeclaude") {
  const db = getDb(false);
  try {
    return db.transaction(() => {
      let existing = [];
      try {
        existing = readApiKeys(db).filter((k) => k.isActive && k.key);
      } catch {
        /* unreadable schema — fall through to insert */
      }

      const preferred = existing.find((k) => /^freeclaude/i.test(String(k.name || ""))) || existing[0];
      if (preferred?.key) {
        return {
          id: preferred.id,
          name: preferred.name,
          key: preferred.key,
          createdAt: preferred.createdAt,
          expiresAt: preferred.expiresAt || null,
          masked: preferred.masked || `${preferred.key.slice(0, 6)}…${preferred.key.slice(-4)}`,
          reused: true,
        };
      }

      return { ...insertApiKey(db, name), reused: false };
    })();
  } finally {
    db.close();
  }
}

function readApiKeys(db) {
  // OmniRoute schemas vary between versions, so only select columns that exist.
  const present = new Set(tableColumns(db, "api_keys"));
  const cols = buildSelectColumns(db, "api_keys", {
    id: "id",
    name: "name",
    key: "key",
    created_at: "createdAt",
    expires_at: "expiresAt",
    last_used_at: "lastUsedAt",
    is_active: "isActive",
    revoked_at: "revokedAt",
  });
  const order = present.has("created_at") ? " ORDER BY created_at DESC" : "";
  return db
    .prepare(`SELECT ${cols} FROM api_keys${order} LIMIT 50`)
    .all()
    .map((r) => ({
      id: r.id,
      name: r.name,
      masked: r.key ? `${r.key.slice(0, 6)}…${r.key.slice(-4)}` : "",
      key: r.key,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      lastUsedAt: r.lastUsedAt,
      // A column the schema does not have must not mean "revoked" — otherwise every key
      // looks dead and ensureApiKey creates a duplicate on each call.
      isActive: (present.has("is_active") ? Boolean(r.isActive) : true) && !r.revokedAt,
    }));
}

function listApiKeys() {
  const db = getDb(true);
  try {
    return readApiKeys(db);
  } finally {
    db.close();
  }
}

function getKiroStatus() {
  const db = getDb(true);
  try {
    const select = buildSelectColumns(db, "provider_connections", {
      id: "id",
      provider: "provider",
      auth_type: "authType",
      is_active: "isActive",
      test_status: "testStatus",
      expires_at: "expiresAt",
      rate_limited_until: "rateLimitedUntil",
      last_error: "lastError",
      last_tested: "lastTested",
      last_used_at: "lastUsedAt",
      backoff_level: "backoffLevel",
      quota_visible: "quotaVisible",
      display_name: "displayName",
      email: "email",
    });
    const rows = db
      .prepare(`SELECT ${select} FROM provider_connections WHERE provider IN ('kiro','kr') ORDER BY priority ASC`)
      .all();

    const now = Date.now();
    return rows.map((r) => {
      const classified = classifyKiroConnection(
        {
          isActive: r.isActive,
          testStatus: r.testStatus,
          lastError: r.lastError,
          rateLimitedUntil: r.rateLimitedUntil,
        },
        now
      );
      const oauthUntil = r.expiresAt ? new Date(r.expiresAt).getTime() : null;
      const oauthLeftMs = oauthUntil ? Math.max(0, oauthUntil - now) : null;
      let detail = classified.detail;
      if (classified.state === "limited" && classified.coolLeftMs > 0) {
        detail = `лимит · ещё ${formatDuration(classified.coolLeftMs)}`;
      } else if (classified.state === "quota") {
        detail = classified.lastError || "квота исчерпана";
      }

      return {
        id: r.id,
        provider: r.provider,
        isActive: classified.isActive,
        state: classified.state,
        detail,
        testStatus: r.testStatus,
        cooling: classified.cooling,
        coolLeftMs: classified.coolLeftMs,
        coolLeftText: classified.cooling ? formatDuration(classified.coolLeftMs) : null,
        rateLimitedUntil: r.rateLimitedUntil || null,
        oauthExpiresAt: r.expiresAt,
        oauthLeftMs,
        oauthLeftText: oauthLeftMs != null ? formatDuration(oauthLeftMs) : null,
        lastError: r.lastError,
        lastTested: r.lastTested,
        displayName: r.displayName || r.email || "Kiro",
      };
    });
  } finally {
    db.close();
  }
}

function getKeyUsage(apiKey) {
  const db = getDb(true);
  try {
    const row = db.prepare("SELECT id, name, key, created_at as createdAt, last_used_at as lastUsedAt FROM api_keys WHERE key = ?").get(apiKey);
    if (!row) {
      return {
        found: false,
        masked: apiKey ? `${apiKey.slice(0, 6)}…${apiKey.slice(-4)}` : "",
        usedTokens: 0,
        usedInput: 0,
        usedOutput: 0,
        requests: 0,
        successRequests: 0,
        limit: null,
        remaining: null,
      };
    }

    const stats = db
      .prepare(
        `SELECT
           COUNT(*) as requests,
           SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successRequests,
           COALESCE(SUM(tokens_input),0) as usedInput,
           COALESCE(SUM(tokens_output),0) as usedOutput,
           COALESCE(SUM(tokens_input + tokens_output + tokens_reasoning),0) as usedTokens
         FROM usage_history WHERE api_key_id = ?`
      )
      .get(row.id);

    const today = db
      .prepare(
        `SELECT
           COUNT(*) as requests,
           COALESCE(SUM(tokens_input + tokens_output + tokens_reasoning),0) as usedTokens
         FROM usage_history
         WHERE api_key_id = ? AND timestamp >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')`
      )
      .get(row.id);

    const limitRow = db
      .prepare(
        `SELECT token_limit as tokenLimit, reset_interval as resetInterval, enabled
         FROM api_key_token_limits WHERE api_key_id = ? AND enabled = 1 LIMIT 1`
      )
      .get(row.id);

    const usedTokens = Number(stats?.usedTokens || 0);
    const limit = limitRow?.enabled ? Number(limitRow.tokenLimit) : null;
    const remaining = limit != null ? Math.max(0, limit - usedTokens) : null;

    return {
      found: true,
      id: row.id,
      name: row.name,
      masked: `${row.key.slice(0, 6)}…${row.key.slice(-4)}`,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      usedTokens,
      usedInput: Number(stats?.usedInput || 0),
      usedOutput: Number(stats?.usedOutput || 0),
      requests: Number(stats?.requests || 0),
      successRequests: Number(stats?.successRequests || 0),
      todayTokens: Number(today?.usedTokens || 0),
      todayRequests: Number(today?.requests || 0),
      limit,
      remaining,
      unlimited: limit == null,
    };
  } finally {
    db.close();
  }
}

function logoutKiro(connectionId = null) {
  const db = getDb(false);
  try {
    const now = new Date().toISOString();
    const baseAssignments = {
      is_active: 0,
      access_token: null,
      refresh_token: null,
      id_token: null,
      api_key: null,
      test_status: "disconnected",
      last_error: "logged out from FreeClaude",
      last_error_at: now,
      rate_limited_until: null,
      updated_at: now,
    };

    if (connectionId) {
      const info = db.prepare(`SELECT id FROM provider_connections WHERE id = ? AND provider IN ('kiro','kr')`).get(connectionId);
      if (!info) throw new Error("Kiro-соединение не найдено");
      const { set, values } = buildUpdateSet(db, "provider_connections", baseAssignments);
      db.prepare(`UPDATE provider_connections SET ${set} WHERE id = ?`).run(...values, connectionId);
      return { ok: true, removed: 1, id: connectionId };
    }

    // Гасим ВСЕ Kiro/kr записи, не только is_active=1 (иначе «хвосты» остаются активными)
    const before = db
      .prepare(
        `SELECT COUNT(*) as c FROM provider_connections
         WHERE provider IN ('kiro','kr')
           AND (is_active = 1 OR access_token IS NOT NULL OR refresh_token IS NOT NULL OR api_key IS NOT NULL)`
      )
      .get();

    const { set, values } = buildUpdateSet(db, "provider_connections", baseAssignments);
    const result = db.prepare(`UPDATE provider_connections SET ${set} WHERE provider IN ('kiro','kr')`).run(...values);

    return { ok: true, removed: Math.max(result.changes, Number(before?.c || 0)) };
  } finally {
    db.close();
  }
}

function getAccountLimitInfo() {
  const kiro = getKiroStatus();
  try {
    const summary = summarizeAccountLimits(kiro, { minLimitMs: MIN_LIMIT_MS });
    const resetInMs = Number(summary.resetInMs || 0);
    return {
      kiro,
      connected: Boolean(summary.connected),
      banned: Boolean(summary.banned),
      banReason: summary.banReason,
      limited: Boolean(summary.limited),
      resetAt: summary.resetAt,
      resetInMs,
      resetInText:
        resetInMs > 0
          ? formatDuration(resetInMs)
          : summary.limitedRow?.coolLeftText || null,
      recent429: 0,
      last429At: null,
    };
  } catch (err) {
    return {
      kiro,
      connected: false,
      banned: false,
      banReason: null,
      limited: false,
      resetAt: null,
      resetInMs: 0,
      resetInText: null,
      recent429: 0,
      last429At: null,
      error: String(err.message || err),
    };
  }
}

/**
 * After a fresh Builder ID login the previous account's cooldown often sticks on
 * the same OmniRoute row (or in memory). Clear soft limits on live connections so
 * the UI and router treat the new session as clean. Real AWS bans are left alone.
 */
function clearKiroCooldowns() {
  const db = getDb(false);
  try {
    const cols = new Set(tableColumns(db, "provider_connections"));
    const now = new Date().toISOString();
    const setParts = [];
    if (cols.has("rate_limited_until")) setParts.push("rate_limited_until = NULL");
    if (cols.has("backoff_level")) setParts.push("backoff_level = 0");
    if (cols.has("last_error")) setParts.push("last_error = NULL");
    if (cols.has("last_error_at")) setParts.push("last_error_at = NULL");
    if (cols.has("test_status")) {
      setParts.push(
        `test_status = CASE
           WHEN lower(COALESCE(test_status, '')) IN ('rate_limited','credits_exhausted','error','limited')
             THEN 'active'
           ELSE test_status
         END`
      );
    }
    if (cols.has("updated_at")) setParts.push("updated_at = ?");
    if (!setParts.length) return { ok: true, cleared: 0 };

    const where = ["provider IN ('kiro','kr')"];
    if (cols.has("is_active")) where.push("is_active = 1");
    if (cols.has("test_status")) {
      where.push("lower(COALESCE(test_status, '')) NOT IN ('banned')");
    }

    const values = cols.has("updated_at") ? [now] : [];
    const result = db
      .prepare(`UPDATE provider_connections SET ${setParts.join(", ")} WHERE ${where.join(" AND ")}`)
      .run(...values);
    return { ok: true, cleared: Number(result.changes || 0) };
  } finally {
    db.close();
  }
}

/**
 * После OAuth OmniRoute иногда пишет токены, но оставляет is_active=0 / disconnected.
 * Поднимаем такие строки, чтобы UI не думал, что «не авторизован».
 */
function healKiroConnections() {
  const db = getDb(false);
  try {
    return healKiroOn(db);
  } finally {
    db.close();
  }
}

/** Same repair against a caller-owned handle, so it can join a wider transaction. */
function healKiroOn(db) {
  const cols = new Set(tableColumns(db, "provider_connections"));
  const now = new Date().toISOString();

  const setParts = [];
  if (cols.has("is_active")) setParts.push("is_active = 1");
  if (cols.has("test_status")) {
    setParts.push(
      "test_status = CASE WHEN test_status IS NULL OR test_status = '' OR lower(test_status) IN ('disconnected','pending','unknown') THEN 'active' ELSE test_status END"
    );
  }
  if (cols.has("last_error")) setParts.push("last_error = NULL");
  if (cols.has("last_error_at")) setParts.push("last_error_at = NULL");
  if (cols.has("updated_at")) setParts.push("updated_at = ?");

  if (!setParts.length) return { ok: true, healed: 0 };

  const whereParts = ["provider IN ('kiro','kr')"];
  const tokenConds = [];
  if (cols.has("access_token")) tokenConds.push("(access_token IS NOT NULL AND trim(access_token) != '')");
  if (cols.has("refresh_token")) tokenConds.push("(refresh_token IS NOT NULL AND trim(refresh_token) != '')");
  if (cols.has("api_key")) tokenConds.push("(api_key IS NOT NULL AND trim(api_key) != '')");
  if (tokenConds.length) whereParts.push(`(${tokenConds.join(" OR ")})`);

  const statusConds = [];
  if (cols.has("is_active")) statusConds.push("(is_active = 0 OR is_active IS NULL)");
  if (cols.has("test_status")) statusConds.push("lower(COALESCE(test_status, '')) IN ('disconnected', 'pending', 'unknown', '')");
  if (statusConds.length) whereParts.push(`(${statusConds.join(" OR ")})`);
  if (cols.has("test_status")) whereParts.push("lower(COALESCE(test_status, '')) NOT IN ('banned', 'expired', 'credits_exhausted')");

  const values = cols.has("updated_at") ? [now] : [];
  const result = db
    .prepare(`UPDATE provider_connections SET ${setParts.join(", ")} WHERE ${whereParts.join(" AND ")}`)
    .run(...values);
  return { ok: true, healed: Number(result.changes || 0) };
}

/** Есть ли живое Kiro-соединение с токенами (даже если UI ещё не обновился). */
function hasKiroCredentials() {
  const db = getDb(true);
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) as c FROM provider_connections
         WHERE provider IN ('kiro','kr')
           AND (
             (access_token IS NOT NULL AND trim(access_token) != '')
             OR (refresh_token IS NOT NULL AND trim(refresh_token) != '')
             OR (api_key IS NOT NULL AND trim(api_key) != '')
           )`
      )
      .get();
    return Number(row?.c || 0) > 0;
  } finally {
    db.close();
  }
}

function doctorContext(apiKey) {
  return { getDb, tableColumns, healOn: healKiroOn, apiKey: apiKey || null };
}

function diagnoseInstall(apiKey = null) {
  return omniDoctor.diagnose(doctorContext(apiKey));
}

function repairInstall(apiKey = null, codes = null) {
  return omniDoctor.repair(doctorContext(apiKey), { codes });
}

module.exports = {
  createApiKey,
  ensureApiKey,
  diagnoseInstall,
  repairInstall,
  listApiKeys,
  getKiroStatus,
  getKeyUsage,
  logoutKiro,
  clearKiroCooldowns,
  getAccountLimitInfo,
  healKiroConnections,
  hasKiroCredentials,
  formatDuration,
  getDb,
  tableColumns,
  candidateDbPaths,
  dbPath: resolveDbPath,
  // OmniRoute may create the database after we start, so resolve on every read.
  get DB_PATH() {
    return resolveDbPath();
  },
};
