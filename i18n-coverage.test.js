const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { EN, RU } = require("./i18n");

/**
 * Guards the wiring rather than the wording: a key can be renamed in the dictionary and
 * still look fine in review while the UI quietly starts printing raw key names.
 */

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

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), "utf8");
const SERVER = read("server.js");
const APP = read("public/app.js");
const HTML = read("public/index.html");

function collect(source, pattern) {
  const found = new Set();
  for (const m of source.matchAll(pattern)) found.add(m[1]);
  return [...found];
}

scenario("every t() key in the browser code exists", () => {
  const keys = collect(APP, /\bt\(\s*"([^"${}]+)"/g);
  assert.ok(keys.length > 60, `only found ${keys.length} keys — did the scan break?`);
  const missing = keys.filter((k) => !(k in EN));
  assert.deepStrictEqual(missing, [], `unknown keys: ${missing.join(", ")}`);
});

scenario("every st() key on the server exists", () => {
  const keys = collect(SERVER, /\bst\(\s*"([^"${}]+)"/g);
  assert.ok(keys.length > 40, `only found ${keys.length} keys — did the scan break?`);
  const missing = keys.filter((k) => !(k in EN));
  assert.deepStrictEqual(missing, [], `unknown keys: ${missing.join(", ")}`);
});

scenario("every data-i18n key in the markup exists", () => {
  const keys = collect(HTML, /data-i18n(?:-placeholder|-title|-aria)?="([^"]+)"/g);
  assert.ok(keys.length > 40, `only found ${keys.length} keys — did the scan break?`);
  const missing = keys.filter((k) => !(k in EN));
  assert.deepStrictEqual(missing, [], `unknown keys: ${missing.join(", ")}`);
});

scenario("the login modal's own strings are all translatable", () => {
  for (const key of ["kiro.retry", "kiro.simpleTitle", "kiro.simpleDone", "kiro.browserHint", "common.cancel"]) {
    assert.ok(key in EN, `${key} missing`);
  }
});

/** Quoted text only — comments are allowed to stay in whichever language they were written. */
function cyrillicLiterals(source) {
  const out = [];
  const strings = source.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) || [];
  for (const s of strings) {
    if (/[А-Яа-яЁё]/.test(s)) out.push(s.slice(0, 70));
  }
  return out;
}

scenario("no Russian text is hard-coded in the server", () => {
  assert.deepStrictEqual(cyrillicLiterals(SERVER), []);
});

scenario("no Russian text is hard-coded in the browser code", () => {
  assert.deepStrictEqual(cyrillicLiterals(APP), []);
});

scenario("the markup ships English defaults only", () => {
  // The one exception is the language picker naming Russian in Russian.
  const lines = HTML.split("\n").filter((l) => /[А-Яа-яЁё]/.test(l));
  const unexpected = lines.filter((l) => !l.includes('data-i18n="lang.name.ru"'));
  assert.deepStrictEqual(unexpected, [], `Russian left in markup:\n${unexpected.join("\n")}`);
});

scenario("markup defaults match the English dictionary", () => {
  // A stale default would be what the user sees for the split second before JS runs.
  const mismatches = [];
  for (const m of HTML.matchAll(/data-i18n="([^"]+)"[^>]*>([^<]*)</g)) {
    const [, key, text] = m;
    const expected = EN[key];
    if (expected && text.trim() && text.trim() !== expected.trim()) {
      mismatches.push(`${key}: markup "${text.trim()}" vs dict "${expected}"`);
    }
  }
  assert.deepStrictEqual(mismatches, [], mismatches.join("\n"));
});

scenario("the language switcher offers both flags", () => {
  assert.match(HTML, /id="flag-en"/, "English flag symbol missing");
  assert.match(HTML, /id="flag-ru"/, "Russian flag symbol missing");
  assert.match(HTML, /data-lang="en"/, "English button missing");
  assert.match(HTML, /data-lang="ru"/, "Russian button missing");
});

scenario("the page loads the dictionary before the app", () => {
  const dict = HTML.indexOf('src="/i18n.js"');
  const app = HTML.indexOf('src="/app.js');
  assert.ok(dict > -1, "i18n.js is not loaded at all");
  assert.ok(app > -1, "app.js is not loaded at all");
  assert.ok(dict < app, "i18n.js must come before app.js");
});

scenario("the dictionary route and the language endpoint exist", () => {
  assert.match(SERVER, /u\.pathname === "\/i18n\.js"/);
  assert.match(SERVER, /u\.pathname === "\/api\/lang"/);
});

scenario("Russian is reachable from the dictionary", () => {
  assert.ok(Object.keys(RU).length > 200, "the Russian table looks truncated");
});

process.exit(failed ? 1 : 0);
