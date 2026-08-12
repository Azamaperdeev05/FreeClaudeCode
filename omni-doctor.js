/**
 * A pre-existing OmniRoute can sit in almost any state: models hidden from the
 * dashboard, the provider blocklisted, a stale synced catalog left over from a
 * connection that no longer exists, or an API key restricted to some other
 * provider's models. Each of those silently removes Kiro models from
 * GET /v1/models, so the user sees "not all models" with no explanation.
 *
 * Every check returns a stable `code` that the UI translates, and every fixable
 * check knows how to repair itself. Repairs only ever widen access (unhide,
 * unblock, clear a filter) — nothing here deletes an account or a credential.
 */

const KIRO_PROVIDERS = ["kiro", "kr"];

/** Every code diagnose() can emit, plus the one repair() adds. Each needs a translation. */
const CODES = [
  "kiro-no-active",
  "kiro-inactive",
  "models-hidden",
  "provider-blocked",
  "paid-hidden",
  "catalog-orphan",
  "key-restricted",
  "key-none",
  "key-unknown",
  "key-dead",
  "key-reissued",
];

/** Checks safe to apply without asking: they only restore access FreeClaude needs. */
const AUTO_FIX = new Set([
  "kiro-inactive",
  "models-hidden",
  "provider-blocked",
  "paid-hidden",
  "catalog-orphan",
  "key-restricted",
]);

function readJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function hasTable(db, table) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
  return Boolean(row);
}

function keyValueRow(db, namespace, key) {
  if (!hasTable(db, "key_value")) return null;
  return db.prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?").get(namespace, key) || null;
}

function writeKeyValue(db, namespace, key, value) {
  const res = db
    .prepare("UPDATE key_value SET value = ? WHERE namespace = ? AND key = ?")
    .run(value, namespace, key);
  if (!res.changes) {
    db.prepare("INSERT INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run(namespace, key, value);
  }
}

/** Model visibility lives in two namespaces; the eye toggle writes whichever exists. */
function visibilityNamespaces(db) {
  const found = [];
  for (const namespace of ["customModels", "modelCompatOverrides"]) {
    for (const provider of KIRO_PROVIDERS) {
      const row = keyValueRow(db, namespace, provider);
      if (row) found.push({ namespace, provider, list: readJson(row.value, []) });
    }
  }
  return found;
}

function finding(code, severity, detail = null, extra = {}) {
  return { code, severity, detail, fixable: AUTO_FIX.has(code) || Boolean(extra.fixable), ...extra };
}

/* ------------------------------------------------------------------ checks */

function checkKiroInactive(db) {
  const rows = db
    .prepare(
      `SELECT COUNT(*) c FROM provider_connections
       WHERE provider IN ('kiro','kr')
         AND (is_active = 0 OR is_active IS NULL)
         AND ((access_token IS NOT NULL AND trim(access_token) != '')
           OR (refresh_token IS NOT NULL AND trim(refresh_token) != '')
           OR (api_key IS NOT NULL AND trim(api_key) != ''))
         AND lower(COALESCE(test_status, '')) NOT IN ('banned','expired','credits_exhausted')`
    )
    .get();
  const count = Number(rows?.c || 0);
  return count ? finding("kiro-inactive", "warn", String(count), { count }) : null;
}

/** The catalog is built only from active connections, so zero active means zero models. */
function checkKiroNoActive(db) {
  const row = db
    .prepare(`SELECT COUNT(*) c FROM provider_connections WHERE provider IN ('kiro','kr') AND is_active = 1`)
    .get();
  return Number(row?.c || 0) === 0 ? finding("kiro-no-active", "error", null, { fixable: false }) : null;
}

function checkHiddenModels(db) {
  const hidden = [];
  for (const entry of visibilityNamespaces(db)) {
    if (!Array.isArray(entry.list)) continue;
    for (const model of entry.list) {
      if (model && model.isHidden) hidden.push(String(model.id || "?"));
    }
  }
  return hidden.length
    ? finding("models-hidden", "warn", hidden.slice(0, 6).join(", "), { count: hidden.length })
    : null;
}

function checkBlockedProvider(db) {
  const row = keyValueRow(db, "settings", "blockedProviders");
  const list = readJson(row?.value, []);
  if (!Array.isArray(list)) return null;
  const blocked = list.filter((p) => KIRO_PROVIDERS.includes(String(p || "").toLowerCase()));
  return blocked.length ? finding("provider-blocked", "error", blocked.join(", ")) : null;
}

function checkHidePaid(db) {
  const row = keyValueRow(db, "settings", "hidePaidModels");
  const value = readJson(row?.value, false);
  return value === true || value === 1 ? finding("paid-hidden", "warn") : null;
}

/**
 * A synced catalog wins over the built-in registry, so rows left behind by a
 * deleted connection keep serving an old, shorter model list.
 */
function checkCatalogOrphans(db) {
  if (!hasTable(db, "key_value")) return null;
  const rows = db.prepare("SELECT key FROM key_value WHERE namespace = 'syncedAvailableModels'").all();
  if (!rows.length) return null;

  const live = new Set(
    db
      .prepare("SELECT id FROM provider_connections WHERE provider IN ('kiro','kr') AND is_active = 1")
      .all()
      .map((r) => String(r.id))
  );

  const orphans = rows
    .map((r) => String(r.key))
    .filter((key) => {
      const [provider, connectionId] = key.split(":");
      if (!KIRO_PROVIDERS.includes(String(provider || "").toLowerCase())) return false;
      return !live.has(String(connectionId || ""));
    });

  return orphans.length ? finding("catalog-orphan", "warn", String(orphans.length), { orphans }) : null;
}

/** Restrictions on the key Claude Code uses filter the catalog down before we ever see it. */
function keyRestrictions(row) {
  if (!row) return [];
  const limits = [];
  const allowed = readJson(row.allowed_models, []);
  if (Array.isArray(allowed) && allowed.length) limits.push("allowed_models");
  const blocked = readJson(row.blocked_models, []);
  if (Array.isArray(blocked) && blocked.length) limits.push("blocked_models");
  const quotas = readJson(row.allowed_quotas, []);
  if (Array.isArray(quotas) && quotas.length) limits.push("allowed_quotas");
  if (row.disable_non_public_models === 1) limits.push("disable_non_public_models");
  return limits;
}

function findKeyRow(db, apiKey, columns) {
  if (!apiKey) return null;
  const wanted = [
    "id", "name", "key", "is_active", "is_banned", "revoked_at", "expires_at",
    "allowed_models", "blocked_models", "allowed_quotas", "disable_non_public_models",
  ].filter((c) => columns.has(c));
  if (!wanted.includes("key")) return null;
  return db.prepare(`SELECT ${wanted.join(", ")} FROM api_keys WHERE key = ?`).get(apiKey) || null;
}

function checkActiveKey(db, columns, apiKey) {
  if (!apiKey) return [finding("key-none", "error", null, { fixable: true })];

  const row = findKeyRow(db, apiKey, columns);
  if (!row) return [finding("key-unknown", "error", null, { fixable: true })];

  const out = [];
  const expired = row.expires_at && new Date(row.expires_at).getTime() < Date.now();
  if (row.is_active === 0 || row.is_banned === 1 || row.revoked_at || expired) {
    out.push(finding("key-dead", "error", null, { fixable: true }));
  }

  const limits = keyRestrictions(row);
  if (limits.length) out.push(finding("key-restricted", "warn", limits.join(", "), { keyId: row.id, limits }));
  return out;
}

/* ----------------------------------------------------------------- repairs */

function fixKiroInactive(db, healOn) {
  return Number(healOn(db)?.healed || 0) > 0;
}

function fixHiddenModels(db) {
  let changed = false;
  for (const entry of visibilityNamespaces(db)) {
    if (!Array.isArray(entry.list)) continue;
    if (!entry.list.some((m) => m && m.isHidden)) continue;
    const next = entry.list.map((m) => (m && m.isHidden ? { ...m, isHidden: false } : m));
    writeKeyValue(db, entry.namespace, entry.provider, JSON.stringify(next));
    changed = true;
  }
  return changed;
}

function fixBlockedProvider(db) {
  const row = keyValueRow(db, "settings", "blockedProviders");
  const list = readJson(row?.value, []);
  if (!Array.isArray(list)) return false;
  const next = list.filter((p) => !KIRO_PROVIDERS.includes(String(p || "").toLowerCase()));
  if (next.length === list.length) return false;
  writeKeyValue(db, "settings", "blockedProviders", JSON.stringify(next));
  return true;
}

function fixHidePaid(db) {
  writeKeyValue(db, "settings", "hidePaidModels", JSON.stringify(false));
  return true;
}

function fixCatalogOrphans(db, orphans) {
  if (!Array.isArray(orphans) || !orphans.length) return false;
  const stmt = db.prepare("DELETE FROM key_value WHERE namespace = 'syncedAvailableModels' AND key = ?");
  let changed = false;
  for (const key of orphans) changed = Boolean(stmt.run(key).changes) || changed;
  return changed;
}

function fixKeyRestrictions(db, columns, keyId) {
  const assignments = [];
  if (columns.has("allowed_models")) assignments.push("allowed_models = '[]'");
  if (columns.has("blocked_models")) assignments.push("blocked_models = NULL");
  if (columns.has("allowed_quotas")) assignments.push("allowed_quotas = '[]'");
  if (columns.has("disable_non_public_models")) assignments.push("disable_non_public_models = 0");
  if (!assignments.length) return false;
  return Boolean(db.prepare(`UPDATE api_keys SET ${assignments.join(", ")} WHERE id = ?`).run(keyId).changes);
}

/* -------------------------------------------------------------- public API */

/**
 * @param {object} ctx
 * @param {(readonly?: boolean) => object} ctx.getDb  opens the OmniRoute database
 * @param {(db: object, table: string) => string[]} ctx.tableColumns
 * @param {(db: object) => {healed: number}} ctx.healOn  reactivates Kiro rows
 * @param {string|null} ctx.apiKey  the key Claude Code is configured with
 */
function diagnose(ctx) {
  const db = ctx.getDb(true);
  try {
    const columns = new Set(ctx.tableColumns(db, "api_keys"));
    const findings = [
      checkKiroNoActive(db),
      checkKiroInactive(db),
      checkHiddenModels(db),
      checkBlockedProvider(db),
      checkHidePaid(db),
      checkCatalogOrphans(db),
      ...checkActiveKey(db, columns, ctx.apiKey),
    ].filter(Boolean);

    return {
      ok: findings.length === 0,
      findings,
      autoFixable: findings.filter((f) => AUTO_FIX.has(f.code)).map((f) => f.code),
    };
  } finally {
    db.close();
  }
}

/**
 * Applies the repairs FreeClaude owns. Anything needing a fresh API key or a new
 * Kiro login is reported back so the caller (which owns settings.json and HTTP)
 * can finish the job.
 */
function repair(ctx, { codes = null } = {}) {
  const report = diagnose(ctx);
  const wanted = codes ? new Set(codes) : new Set(report.autoFixable);

  const db = ctx.getDb(false);
  const fixed = [];
  const failed = [];
  try {
    const columns = new Set(ctx.tableColumns(db, "api_keys"));
    for (const item of report.findings) {
      if (!wanted.has(item.code)) continue;
      try {
        let done = false;
        if (item.code === "kiro-inactive") done = fixKiroInactive(db, ctx.healOn);
        else if (item.code === "models-hidden") done = fixHiddenModels(db);
        else if (item.code === "provider-blocked") done = fixBlockedProvider(db);
        else if (item.code === "paid-hidden") done = fixHidePaid(db);
        else if (item.code === "catalog-orphan") done = fixCatalogOrphans(db, item.orphans);
        else if (item.code === "key-restricted") done = fixKeyRestrictions(db, columns, item.keyId);
        if (done) fixed.push(item.code);
      } catch (err) {
        failed.push({ code: item.code, error: String(err.message || err) });
      }
    }
  } finally {
    db.close();
  }

  return {
    fixed,
    failed,
    // Codes the caller must act on: issuing a key or asking the user to log in.
    pending: report.findings
      .filter((f) => ["key-none", "key-unknown", "key-dead", "kiro-no-active"].includes(f.code))
      .map((f) => f.code),
  };
}

module.exports = { diagnose, repair, AUTO_FIX, CODES, KIRO_PROVIDERS };
