#!/usr/bin/env node
/** Runs under system Node (not pkg) so better-sqlite3 native addon works. */
const fs = require("fs");
const path = require("path");

try {
  const keys = require(path.join(__dirname, "omni-keys.js"));
  const fn = process.argv[2];
  if (!fn || typeof keys[fn] !== "function") {
    process.stdout.write(JSON.stringify({ error: `Unknown fn: ${fn}` }));
    process.exit(2);
  }
  let args = [];
  try {
    const raw = fs.readFileSync(0, "utf8");
    if (raw && raw.trim()) args = JSON.parse(raw);
  } catch {
    args = [];
  }
  if (!Array.isArray(args)) args = [args];
  const result = keys[fn](...args);
  process.stdout.write(JSON.stringify(result == null ? null : result));
} catch (err) {
  process.stdout.write(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
  process.exit(1);
}
