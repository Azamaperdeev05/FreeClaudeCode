const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const doctor = require("./omni-doctor");

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

/** A miniature OmniRoute database: only the columns the doctor actually reads. */
function makeDb() {
  const file = path.join(os.tmpdir(), `fc-doctor-${process.pid}-${Math.random().toString(36).slice(2)}.sqlite`);
  const db = new Database(file);
  db.exec(`
    CREATE TABLE provider_connections (
      id TEXT PRIMARY KEY, provider TEXT, is_active INTEGER, test_status TEXT,
      access_token TEXT, refresh_token TEXT, api_key TEXT, last_error TEXT,
      last_error_at TEXT, updated_at TEXT
    );
    CREATE TABLE api_keys (
      id TEXT PRIMARY KEY, name TEXT, key TEXT, is_active INTEGER, is_banned INTEGER,
      revoked_at TEXT, expires_at TEXT, allowed_models TEXT, blocked_models TEXT,
      allowed_quotas TEXT, disable_non_public_models INTEGER
    );
    CREATE TABLE key_value (namespace TEXT, key TEXT, value TEXT, PRIMARY KEY (namespace, key));
  `);
  db.close();
  return file;
}

function ctxFor(file, apiKey) {
  const open = (readonly = false) => new Database(file, { readonly });
  return {
    getDb: open,
    tableColumns: (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name),
    healOn: (db) =>
      ({
        healed: db
          .prepare(
            `UPDATE provider_connections SET is_active = 1
             WHERE provider IN ('kiro','kr') AND is_active = 0
               AND (access_token IS NOT NULL AND trim(access_token) != '')`
          )
          .run().changes,
      }),
    apiKey,
  };
}

function withDb(fn) {
  const file = makeDb();
  try {
    return fn(file, (sql, ...args) => {
      const db = new Database(file);
      try {
        return db.prepare(sql).run(...args);
      } finally {
        db.close();
      }
    });
  } finally {
    fs.rmSync(file, { force: true });
  }
}

function codes(report) {
  return report.findings.map((f) => f.code).sort();
}

const HEALTHY_KEY = ["k1", "freeclaude", "sk-good", 1, 0, null, null, "[]", null, "[]", 0];

function seedHealthy(run) {
  run(
    `INSERT INTO provider_connections (id, provider, is_active, test_status, access_token)
     VALUES ('c1', 'kiro', 1, 'active', 'tok')`
  );
  run(
    `INSERT INTO api_keys (id, name, key, is_active, is_banned, revoked_at, expires_at,
       allowed_models, blocked_models, allowed_quotas, disable_non_public_models)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...HEALTHY_KEY
  );
}

check("healthy install reports nothing", () =>
  withDb((file, run) => {
    seedHealthy(run);
    const report = doctor.diagnose(ctxFor(file, "sk-good"));
    assert.deepStrictEqual(report.findings, [], JSON.stringify(report.findings));
    assert.strictEqual(report.ok, true);
  })
);

check("no active Kiro connection is an error and is not auto-fixable", () =>
  withDb((file, run) => {
    seedHealthy(run);
    run(`UPDATE provider_connections SET is_active = 0`);
    const report = doctor.diagnose(ctxFor(file, "sk-good"));
    const item = report.findings.find((f) => f.code === "kiro-no-active");
    assert.ok(item, "expected kiro-no-active");
    assert.strictEqual(item.fixable, false);
  })
);

check("inactive connection with tokens is detected and reactivated", () =>
  withDb((file, run) => {
    seedHealthy(run);
    run(`UPDATE provider_connections SET is_active = 0`);
    assert.ok(codes(doctor.diagnose(ctxFor(file, "sk-good"))).includes("kiro-inactive"));

    const res = doctor.repair(ctxFor(file, "sk-good"));
    assert.ok(res.fixed.includes("kiro-inactive"), JSON.stringify(res));
    assert.ok(!codes(doctor.diagnose(ctxFor(file, "sk-good"))).includes("kiro-inactive"));
  })
);

for (const namespace of ["customModels", "modelCompatOverrides"]) {
  check(`hidden models in ${namespace} are detected and unhidden`, () =>
    withDb((file, run) => {
      seedHealthy(run);
      run(
        `INSERT INTO key_value (namespace, key, value) VALUES (?, 'kiro', ?)`,
        namespace,
        JSON.stringify([
          { id: "claude-sonnet-4.5", isHidden: true },
          { id: "gpt-5.6-luna", isHidden: false },
        ])
      );
      const report = doctor.diagnose(ctxFor(file, "sk-good"));
      const item = report.findings.find((f) => f.code === "models-hidden");
      assert.ok(item, "expected models-hidden");
      assert.strictEqual(item.count, 1);

      assert.ok(doctor.repair(ctxFor(file, "sk-good")).fixed.includes("models-hidden"));
      assert.ok(!codes(doctor.diagnose(ctxFor(file, "sk-good"))).includes("models-hidden"));

      // Unhiding must not drop the other entries or their fields.
      const db = new Database(file, { readonly: true });
      const saved = JSON.parse(
        db.prepare("SELECT value v FROM key_value WHERE namespace = ? AND key = 'kiro'").get(namespace).v
      );
      db.close();
      assert.strictEqual(saved.length, 2);
      assert.deepStrictEqual(saved.map((m) => m.isHidden), [false, false]);
    })
  );
}

check("blocked kiro provider is detected and unblocked", () =>
  withDb((file, run) => {
    seedHealthy(run);
    run(
      `INSERT INTO key_value (namespace, key, value) VALUES ('settings','blockedProviders',?)`,
      JSON.stringify(["kiro", "openai"])
    );
    assert.ok(codes(doctor.diagnose(ctxFor(file, "sk-good"))).includes("provider-blocked"));
    assert.ok(doctor.repair(ctxFor(file, "sk-good")).fixed.includes("provider-blocked"));

    const db = new Database(file, { readonly: true });
    const saved = JSON.parse(
      db.prepare("SELECT value v FROM key_value WHERE key = 'blockedProviders'").get().v
    );
    db.close();
    // Other providers the user blocked on purpose must survive.
    assert.deepStrictEqual(saved, ["openai"]);
  })
);

check("hidePaidModels is detected and turned off", () =>
  withDb((file, run) => {
    seedHealthy(run);
    run(`INSERT INTO key_value (namespace, key, value) VALUES ('settings','hidePaidModels','true')`);
    assert.ok(codes(doctor.diagnose(ctxFor(file, "sk-good"))).includes("paid-hidden"));
    assert.ok(doctor.repair(ctxFor(file, "sk-good")).fixed.includes("paid-hidden"));
    assert.ok(!codes(doctor.diagnose(ctxFor(file, "sk-good"))).includes("paid-hidden"));
  })
);

check("orphaned synced catalog is removed but a live one is kept", () =>
  withDb((file, run) => {
    seedHealthy(run);
    run(`INSERT INTO key_value (namespace, key, value) VALUES ('syncedAvailableModels','kiro:c1','[]')`);
    run(`INSERT INTO key_value (namespace, key, value) VALUES ('syncedAvailableModels','kiro:gone','[]')`);
    const item = doctor.diagnose(ctxFor(file, "sk-good")).findings.find((f) => f.code === "catalog-orphan");
    assert.ok(item, "expected catalog-orphan");
    assert.deepStrictEqual(item.orphans, ["kiro:gone"]);

    assert.ok(doctor.repair(ctxFor(file, "sk-good")).fixed.includes("catalog-orphan"));
    const db = new Database(file, { readonly: true });
    const left = db
      .prepare("SELECT key FROM key_value WHERE namespace = 'syncedAvailableModels'")
      .all()
      .map((r) => r.key);
    db.close();
    assert.deepStrictEqual(left, ["kiro:c1"]);
  })
);

check("key restrictions are detected and cleared", () =>
  withDb((file, run) => {
    seedHealthy(run);
    run(
      `UPDATE api_keys SET allowed_models = ?, disable_non_public_models = 1 WHERE key = 'sk-good'`,
      JSON.stringify(["kimi/k2"])
    );
    const item = doctor.diagnose(ctxFor(file, "sk-good")).findings.find((f) => f.code === "key-restricted");
    assert.ok(item, "expected key-restricted");
    assert.deepStrictEqual(item.limits, ["allowed_models", "disable_non_public_models"]);

    assert.ok(doctor.repair(ctxFor(file, "sk-good")).fixed.includes("key-restricted"));
    assert.ok(!codes(doctor.diagnose(ctxFor(file, "sk-good"))).includes("key-restricted"));
  })
);

check("a key missing from OmniRoute is reported as pending, not silently fixed", () =>
  withDb((file, run) => {
    seedHealthy(run);
    const report = doctor.diagnose(ctxFor(file, "sk-someone-elses"));
    assert.ok(codes(report).includes("key-unknown"));
    assert.ok(!report.autoFixable.includes("key-unknown"));
    assert.deepStrictEqual(doctor.repair(ctxFor(file, "sk-someone-elses")).pending, ["key-unknown"]);
  })
);

check("revoked or banned key is reported as dead", () =>
  withDb((file, run) => {
    seedHealthy(run);
    run(`UPDATE api_keys SET is_banned = 1 WHERE key = 'sk-good'`);
    assert.ok(codes(doctor.diagnose(ctxFor(file, "sk-good"))).includes("key-dead"));

    run(`UPDATE api_keys SET is_banned = 0, expires_at = '2000-01-01T00:00:00Z' WHERE key = 'sk-good'`);
    assert.ok(codes(doctor.diagnose(ctxFor(file, "sk-good"))).includes("key-dead"));
  })
);

check("missing key is reported when Claude Code has none", () =>
  withDb((file, run) => {
    seedHealthy(run);
    assert.ok(codes(doctor.diagnose(ctxFor(file, null))).includes("key-none"));
  })
);

check("repair only touches the codes it is asked for", () =>
  withDb((file, run) => {
    seedHealthy(run);
    run(`INSERT INTO key_value (namespace, key, value) VALUES ('settings','hidePaidModels','true')`);
    run(`UPDATE api_keys SET allowed_models = ? WHERE key = 'sk-good'`, JSON.stringify(["x"]));

    const res = doctor.repair(ctxFor(file, "sk-good"), { codes: ["paid-hidden"] });
    assert.deepStrictEqual(res.fixed, ["paid-hidden"]);
    assert.ok(codes(doctor.diagnose(ctxFor(file, "sk-good"))).includes("key-restricted"));
  })
);

check("several problems at once are all found and fixed in one pass", () =>
  withDb((file, run) => {
    seedHealthy(run);
    run(`UPDATE provider_connections SET is_active = 0`);
    run(
      `INSERT INTO key_value (namespace, key, value) VALUES ('customModels','kiro',?)`,
      JSON.stringify([{ id: "a", isHidden: true }])
    );
    run(
      `INSERT INTO key_value (namespace, key, value) VALUES ('settings','blockedProviders',?)`,
      JSON.stringify(["kr"])
    );
    run(`UPDATE api_keys SET blocked_models = ? WHERE key = 'sk-good'`, JSON.stringify(["kiro/*"]));

    const res = doctor.repair(ctxFor(file, "sk-good"));
    assert.deepStrictEqual(
      res.fixed.sort(),
      ["kiro-inactive", "models-hidden", "provider-blocked", "key-restricted"].sort(),
      JSON.stringify(res)
    );
    assert.deepStrictEqual(res.failed, []);
    assert.strictEqual(doctor.diagnose(ctxFor(file, "sk-good")).ok, true);
  })
);

check("a database without key_value still diagnoses", () =>
  withDb((file, run) => {
    seedHealthy(run);
    const db = new Database(file);
    db.exec("DROP TABLE key_value");
    db.close();
    const report = doctor.diagnose(ctxFor(file, "sk-good"));
    assert.deepStrictEqual(report.findings, []);
  })
);

check("every auto-fixable code is one diagnose can actually emit", () => {
  for (const code of doctor.AUTO_FIX) {
    assert.ok(doctor.CODES.includes(code), `AUTO_FIX has unknown code ${code}`);
  }
});

if (failed) {
  console.log(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nall omni-doctor tests passed");
