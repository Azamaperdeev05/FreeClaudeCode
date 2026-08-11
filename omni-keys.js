const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = path.join(process.env.USERPROFILE || "", ".omniroute", "storage.sqlite");

function getDb(readonly = false) {
  const candidates = [
    path.join(process.env.APPDATA || "", "npm", "node_modules", "omniroute", "node_modules", "better-sqlite3"),
    path.join(__dirname, "node_modules", "better-sqlite3"),
    path.join(path.dirname(process.execPath || ""), "node_modules", "better-sqlite3"),
    path.join(path.dirname(process.execPath || ""), "better-sqlite3"),
    "better-sqlite3",
  ];
  let Database = null;
  let lastErr = null;
  for (const mod of candidates) {
    try {
      Database = require(mod);
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!Database) {
    throw new Error(
      "Не найден better-sqlite3 (установи OmniRoute). " + String(lastErr?.message || lastErr || "")
    );
  }
  if (!fs.existsSync(DB_PATH)) throw new Error("OmniRoute DB не найдена. Сначала установи и запусти OmniRoute.");
  return new Database(DB_PATH, { readonly });
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
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

function createApiKey(name = "freeclaude") {
  const db = getDb(false);
  try {
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
  } finally {
    db.close();
  }
}

/** Есть активный ключ — вернём его; нет — создадим. */
function ensureApiKey(name = "freeclaude") {
  try {
    const keys = listApiKeys().filter((k) => k.isActive && k.key);
    const preferred =
      keys.find((k) => /^freeclaude/i.test(String(k.name || ""))) ||
      keys[0];
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
  } catch {
    /* create below */
  }
  return { ...createApiKey(name), reused: false };
}

function listApiKeys() {
  const db = getDb(true);
  try {
    return db
      .prepare(
        `SELECT id, name, key, created_at as createdAt, expires_at as expiresAt, last_used_at as lastUsedAt, is_active as isActive, revoked_at as revokedAt
         FROM api_keys ORDER BY created_at DESC LIMIT 50`
      )
      .all()
      .map((r) => ({
        id: r.id,
        name: r.name,
        masked: r.key ? `${r.key.slice(0, 6)}…${r.key.slice(-4)}` : "",
        key: r.key,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        lastUsedAt: r.lastUsedAt,
        isActive: Boolean(r.isActive) && !r.revokedAt,
      }));
  } finally {
    db.close();
  }
}

function getKiroStatus() {
  const db = getDb(true);
  try {
    const rows = db
      .prepare(
        `SELECT id, provider, auth_type as authType, is_active as isActive, test_status as testStatus,
                expires_at as expiresAt, rate_limited_until as rateLimitedUntil, last_error as lastError,
                last_tested as lastTested, last_used_at as lastUsedAt, backoff_level as backoffLevel,
                quota_visible as quotaVisible, display_name as displayName, email
         FROM provider_connections WHERE provider IN ('kiro','kr') ORDER BY priority ASC`
      )
      .all();

    const now = Date.now();
    const terminal = new Set(["banned", "expired", "credits_exhausted"]);
    return rows.map((r) => {
      const isActive = r.isActive === true || r.isActive === 1 || r.isActive === "1";
      const testStatus = String(r.testStatus || "").trim().toLowerCase();
      const lastError = r.lastError ? String(r.lastError) : "";
      const rateUntil = r.rateLimitedUntil ? new Date(r.rateLimitedUntil).getTime() : null;
      const oauthUntil = r.expiresAt ? new Date(r.expiresAt).getTime() : null;
      const cooling = rateUntil && rateUntil > now;
      const oauthLeftMs = oauthUntil ? Math.max(0, oauthUntil - now) : null;
      const coolLeftMs = cooling ? Math.max(0, rateUntil - now) : 0;
      const looksBanned =
        terminal.has(testStatus) ||
        /suspend|banned|locked your account|security precaution/i.test(lastError);

      let state = "ok";
      let detail = "активен";
      if (looksBanned) {
        state = "banned";
        detail = lastError || testStatus || "аккаунт заблокирован";
      } else if (!isActive || testStatus === "disconnected") {
        state = "off";
        detail = "выключен";
      } else if (cooling) {
        state = "limited";
        detail = `лимит · ещё ${formatDuration(coolLeftMs)}`;
      } else if (testStatus && testStatus !== "active") {
        state = "warn";
        detail = testStatus;
      } else if (lastError) {
        state = "warn";
        detail = lastError.slice(0, 120);
      }

      return {
        id: r.id,
        provider: r.provider,
        isActive,
        state,
        detail,
        testStatus: r.testStatus,
        cooling,
        coolLeftMs,
        coolLeftText: cooling ? formatDuration(coolLeftMs) : null,
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

function formatDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return "—";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}с`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}м ${rs}с`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 48) return `${h}ч ${rm}м`;
  const d = Math.floor(h / 24);
  return `${d}д ${h % 24}ч`;
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
    if (connectionId) {
      const info = db.prepare(`SELECT id FROM provider_connections WHERE id = ? AND provider IN ('kiro','kr')`).get(connectionId);
      if (!info) throw new Error("Kiro-соединение не найдено");
      db.prepare(
        `UPDATE provider_connections
         SET is_active = 0,
             access_token = NULL,
             refresh_token = NULL,
             id_token = NULL,
             api_key = NULL,
             test_status = 'disconnected',
             last_error = 'logged out from FreeClaude',
             last_error_at = ?,
             rate_limited_until = NULL,
             updated_at = ?
         WHERE id = ?`
      ).run(new Date().toISOString(), new Date().toISOString(), connectionId);
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

    const result = db
      .prepare(
        `UPDATE provider_connections
         SET is_active = 0,
             access_token = NULL,
             refresh_token = NULL,
             id_token = NULL,
             api_key = NULL,
             test_status = 'disconnected',
             last_error = 'logged out from FreeClaude',
             last_error_at = ?,
             rate_limited_until = NULL,
             updated_at = ?
         WHERE provider IN ('kiro','kr')`
      )
      .run(new Date().toISOString(), new Date().toISOString());

    return { ok: true, removed: Math.max(result.changes, Number(before?.c || 0)) };
  } finally {
    db.close();
  }
}

function getAccountLimitInfo() {
  const kiro = getKiroStatus();
  // Короткие cooldown (секунды) — нормальная пауза API, не «лимит аккаунта».
  // Баннер/лок только если ждать реально долго.
  const MIN_LIMIT_MS = 60 * 1000;
  try {
    const active = kiro.filter((k) => k.isActive && k.state !== "off" && k.state !== "banned");
    const banned = kiro.find((k) => k.state === "banned");
    const limited = kiro.find(
      (k) => k.isActive && (k.cooling || k.state === "limited") && Number(k.coolLeftMs || 0) >= MIN_LIMIT_MS
    );
    const banReason = banned?.lastError || banned?.detail || null;

    let resetAt = null;
    if (limited?.rateLimitedUntil) {
      const t = new Date(limited.rateLimitedUntil).getTime();
      if (!Number.isNaN(t)) resetAt = t;
    }
    const resetInMs = resetAt ? Math.max(0, resetAt - Date.now()) : limited?.coolLeftMs || 0;

    return {
      kiro,
      connected: active.length > 0,
      banned: Boolean(banned),
      banReason,
      limited: Boolean(limited),
      resetAt,
      resetInMs,
      resetInText: resetInMs > 0 ? formatDuration(resetInMs) : limited?.coolLeftText || null,
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
 * После OAuth OmniRoute иногда пишет токены, но оставляет is_active=0 / disconnected.
 * Поднимаем такие строки, чтобы UI не думал, что «не авторизован».
 */
function healKiroConnections() {
  const db = getDb(false);
  try {
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `UPDATE provider_connections
         SET is_active = 1,
             test_status = CASE
               WHEN test_status IS NULL OR test_status = '' OR lower(test_status) IN ('disconnected','pending','unknown')
               THEN 'active'
               ELSE test_status
             END,
             last_error = NULL,
             last_error_at = NULL,
             updated_at = ?
         WHERE provider IN ('kiro','kr')
           AND (
             (access_token IS NOT NULL AND trim(access_token) != '')
             OR (refresh_token IS NOT NULL AND trim(refresh_token) != '')
             OR (api_key IS NOT NULL AND trim(api_key) != '')
           )
           AND (
             is_active = 0
             OR is_active IS NULL
             OR lower(COALESCE(test_status, '')) IN ('disconnected', 'pending', 'unknown', '')
           )
           AND lower(COALESCE(test_status, '')) NOT IN ('banned', 'expired', 'credits_exhausted')`
      )
      .run(now);
    return { ok: true, healed: Number(result.changes || 0) };
  } finally {
    db.close();
  }
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

module.exports = {
  createApiKey,
  ensureApiKey,
  listApiKeys,
  getKiroStatus,
  getKeyUsage,
  logoutKiro,
  getAccountLimitInfo,
  healKiroConnections,
  hasKiroCredentials,
  formatDuration,
  DB_PATH,
};
