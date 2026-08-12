const assert = require("assert");
const { DICT, LANGS, EN, RU, normalizeLang, t } = require("./i18n");

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

function placeholders(text) {
  return (String(text).match(/\{(\w+)\}/g) || []).sort();
}

scenario("both languages carry exactly the same keys", () => {
  const en = Object.keys(EN).sort();
  const ru = Object.keys(RU).sort();
  const missingInRu = en.filter((k) => !(k in RU));
  const missingInEn = ru.filter((k) => !(k in EN));
  assert.deepStrictEqual(missingInRu, [], `missing in ru: ${missingInRu.join(", ")}`);
  assert.deepStrictEqual(missingInEn, [], `missing in en: ${missingInEn.join(", ")}`);
});

scenario("no translation is left empty", () => {
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(DICT[lang])) {
      assert.ok(String(value).trim(), `${lang}.${key} is empty`);
    }
  }
});

scenario("a key's placeholders match across languages", () => {
  for (const key of Object.keys(EN)) {
    assert.deepStrictEqual(
      placeholders(RU[key]),
      placeholders(EN[key]),
      `placeholders differ for "${key}": en=${placeholders(EN[key])} ru=${placeholders(RU[key])}`
    );
  }
});

scenario("Russian entries are actually translated", () => {
  // Product names and a few tokens are the same in both languages on purpose.
  const sameOnPurpose = new Set([
    "lang.name.en",
    "lang.name.ru",
    "check.node",
    "check.npm",
    "check.omniroute",
    "check.claude",
    "setup.ok",
    "account.ok",
    "log.omniOnline",
  ]);
  const suspicious = Object.keys(EN).filter(
    (k) => !sameOnPurpose.has(k) && EN[k] === RU[k]
  );
  assert.deepStrictEqual(suspicious, [], `untranslated: ${suspicious.join(", ")}`);
});

scenario("English is the default for anything unrecognised", () => {
  for (const value of [undefined, null, "", "de", "zz", "fr-FR", 42, {}]) {
    assert.strictEqual(normalizeLang(value), "en", String(value));
  }
});

scenario("language tags are matched loosely", () => {
  assert.strictEqual(normalizeLang("RU"), "ru");
  assert.strictEqual(normalizeLang("ru-RU"), "ru");
  assert.strictEqual(normalizeLang(" En "), "en");
});

scenario("placeholders are substituted", () => {
  assert.strictEqual(t("en", "models.count", { n: 12 }), "12 models");
  assert.strictEqual(t("ru", "models.count", { n: 12 }), "моделей: 12");
  assert.strictEqual(t("en", "kiro.copied", { code: "ABCD-EFGH" }), "Code copied: ABCD-EFGH");
});

scenario("an unknown placeholder is left alone rather than blanked", () => {
  assert.strictEqual(t("en", "models.count", {}), "{n} models");
});

scenario("an unknown key returns itself instead of throwing", () => {
  assert.strictEqual(t("en", "nope.nothing.here"), "nope.nothing.here");
  assert.strictEqual(t("ru", "nope.nothing.here"), "nope.nothing.here");
});

scenario("an unknown language falls back to English text", () => {
  assert.strictEqual(t("de", "nav.home"), EN["nav.home"]);
});

scenario("every error kind has a title and a hint", () => {
  const kinds = [
    "quota",
    "banned",
    "session",
    "no-account",
    "key",
    "model",
    "context",
    "busy",
    "offline",
    "timeout",
    "rate",
    "forbidden",
    "upstream",
    "request",
    "unknown",
    "empty",
  ];
  for (const lang of LANGS) {
    for (const kind of kinds) {
      for (const part of ["title", "hint"]) {
        const key = `err.${kind}.${part}`;
        assert.ok(DICT[lang][key], `${lang} is missing ${key}`);
      }
    }
  }
});

// The doctor builds its keys at runtime, so nothing else would catch a missing one.
scenario("every setup-doctor code has a title and a hint", () => {
  const { CODES } = require("./omni-doctor");
  for (const lang of LANGS) {
    for (const code of CODES) {
      for (const part of ["title", "hint"]) {
        const key = `doctor.${code}.${part}`;
        assert.ok(DICT[lang][key], `${lang} is missing ${key}`);
      }
    }
  }
});

process.exit(failed ? 1 : 0);
