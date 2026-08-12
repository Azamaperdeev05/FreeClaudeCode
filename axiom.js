"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Claude Code loads ~/.claude/CLAUDE.md into every session, so "Axiom on/off" is really
 * "is that file in place". The persona text is kept in FreeClaude's own data dir so that
 * switching the mode off never destroys it.
 */

function readFileSafe(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** Only the persona file is ours to overwrite; a personal CLAUDE.md must survive untouched. */
function looksLikeAxiom(text) {
  return /axiom/i.test(String(text || "").slice(0, 400));
}

function createAxiom({ claudeMd, backup, store }) {
  /** Adopts a persona the user placed by hand, so the switch works on first run. */
  function seedStore() {
    if (fs.existsSync(store)) return true;
    const current = readFileSafe(claudeMd);
    if (current && looksLikeAxiom(current)) {
      fs.mkdirSync(path.dirname(store), { recursive: true });
      fs.writeFileSync(store, current);
      return true;
    }
    return false;
  }

  function state() {
    const seeded = seedStore();
    const current = readFileSafe(claudeMd);
    const enabled = Boolean(current && looksLikeAxiom(current));
    const stored = readFileSafe(store);
    return {
      available: seeded || enabled,
      enabled,
      bytes: Buffer.byteLength(enabled ? current : stored || ""),
    };
  }

  function enable() {
    const text = readFileSafe(store);
    if (!text) throw new Error("Нет текста Axiom — включать нечего");
    const current = readFileSafe(claudeMd);
    // A CLAUDE.md that is not the persona is the user's own memory: park it, do not lose it.
    if (current != null && !looksLikeAxiom(current)) fs.writeFileSync(backup, current);
    fs.mkdirSync(path.dirname(claudeMd), { recursive: true });
    fs.writeFileSync(claudeMd, text);
  }

  function disable() {
    const current = readFileSafe(claudeMd);
    if (current != null && looksLikeAxiom(current)) {
      // Keep edits made to the persona while it was live.
      fs.mkdirSync(path.dirname(store), { recursive: true });
      fs.writeFileSync(store, current);
      fs.rmSync(claudeMd, { force: true });
    }
    const parked = readFileSafe(backup);
    if (parked != null && !fs.existsSync(claudeMd)) {
      fs.writeFileSync(claudeMd, parked);
      fs.rmSync(backup, { force: true });
    }
  }

  function setEnabled(enabled) {
    seedStore();
    if (enabled) enable();
    else disable();
    return state();
  }

  return { state, setEnabled };
}

module.exports = { createAxiom, looksLikeAxiom };
