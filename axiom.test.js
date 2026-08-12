const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { createAxiom } = require("./axiom");

let failed = 0;
function scenario(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-test-"));
  const claudeMd = path.join(dir, ".claude", "CLAUDE.md");
  const backup = path.join(dir, ".claude", "CLAUDE.md.freeclaude-bak");
  const store = path.join(dir, "data", "axiom.md");
  fs.mkdirSync(path.dirname(claudeMd), { recursive: true });
  fs.mkdirSync(path.dirname(store), { recursive: true });
  try {
    fn({ axiom: createAxiom({ claudeMd, backup, store }), claudeMd, backup, store });
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e.message}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const PERSONA = "# AXIOM — ALWAYS ACTIVE\nbody text\n";

scenario("adopts a hand-placed persona and reports it as on", ({ axiom, store }) => {
  fs.writeFileSync(path.join(path.dirname(store), "..", ".claude", "CLAUDE.md"), PERSONA);
  const s = axiom.state();
  assert.strictEqual(s.enabled, true);
  assert.strictEqual(s.available, true);
  assert.strictEqual(fs.readFileSync(store, "utf8"), PERSONA, "store seeded");
});

scenario("off removes CLAUDE.md but keeps the text", ({ axiom, claudeMd, store }) => {
  fs.writeFileSync(claudeMd, PERSONA);
  const s = axiom.setEnabled(false);
  assert.strictEqual(s.enabled, false);
  assert.strictEqual(s.available, true);
  assert.strictEqual(fs.existsSync(claudeMd), false, "CLAUDE.md removed");
  assert.strictEqual(fs.readFileSync(store, "utf8"), PERSONA, "text kept");
});

scenario("on restores the exact same text", ({ axiom, claudeMd }) => {
  fs.writeFileSync(claudeMd, PERSONA);
  axiom.setEnabled(false);
  const s = axiom.setEnabled(true);
  assert.strictEqual(s.enabled, true);
  assert.strictEqual(fs.readFileSync(claudeMd, "utf8"), PERSONA);
});

scenario("edits made while on survive a toggle", ({ axiom, claudeMd }) => {
  fs.writeFileSync(claudeMd, PERSONA);
  axiom.state();
  fs.writeFileSync(claudeMd, PERSONA + "edited line\n");
  axiom.setEnabled(false);
  axiom.setEnabled(true);
  assert.ok(fs.readFileSync(claudeMd, "utf8").includes("edited line"));
});

scenario("a personal CLAUDE.md is parked, not destroyed", ({ axiom, claudeMd, backup, store }) => {
  const mine = "# My project memory\nuse tabs\n";
  fs.writeFileSync(store, PERSONA);
  fs.writeFileSync(claudeMd, mine);
  axiom.setEnabled(true);
  assert.strictEqual(fs.readFileSync(claudeMd, "utf8"), PERSONA, "persona active");
  assert.strictEqual(fs.readFileSync(backup, "utf8"), mine, "memory parked");
  axiom.setEnabled(false);
  assert.strictEqual(fs.readFileSync(claudeMd, "utf8"), mine, "memory restored");
  assert.strictEqual(fs.existsSync(backup), false, "backup consumed");
});

scenario("no persona anywhere reports unavailable and refuses to turn on", ({ axiom }) => {
  const s = axiom.state();
  assert.strictEqual(s.available, false);
  assert.strictEqual(s.enabled, false);
  assert.throws(() => axiom.setEnabled(true), /Axiom|prompt/i);
});

scenario("turning off twice is harmless", ({ axiom, claudeMd }) => {
  fs.writeFileSync(claudeMd, PERSONA);
  axiom.setEnabled(false);
  const s = axiom.setEnabled(false);
  assert.strictEqual(s.enabled, false);
  assert.strictEqual(s.available, true);
});

{
  const name = "bundled default seeds the store so enable works on a fresh install";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-bundle-"));
  const claudeMd = path.join(dir, ".claude", "CLAUDE.md");
  const backup = path.join(dir, ".claude", "CLAUDE.md.freeclaude-bak");
  const store = path.join(dir, "data", "axiom.md");
  const bundled = path.join(dir, "axiom-default.md");
  fs.mkdirSync(path.dirname(claudeMd), { recursive: true });
  fs.mkdirSync(path.dirname(store), { recursive: true });
  fs.writeFileSync(bundled, PERSONA);
  try {
    const axiom = createAxiom({ claudeMd, backup, store, bundled });
    const before = axiom.state();
    assert.strictEqual(before.available, true);
    assert.strictEqual(before.enabled, false);
    assert.strictEqual(fs.readFileSync(store, "utf8"), PERSONA);

    const on = axiom.setEnabled(true);
    assert.strictEqual(on.enabled, true);
    assert.strictEqual(fs.readFileSync(claudeMd, "utf8"), PERSONA);

    fs.writeFileSync(store, PERSONA + "custom\n");
    const again = createAxiom({ claudeMd, backup, store, bundled });
    again.state();
    assert.ok(fs.readFileSync(store, "utf8").includes("custom"), "bundle must not overwrite store");
    again.setEnabled(true);
    assert.ok(fs.readFileSync(claudeMd, "utf8").includes("custom"));
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e.message}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

process.exit(failed ? 1 : 0);
