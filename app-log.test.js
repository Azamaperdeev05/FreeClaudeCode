"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createAppLog } = require("./app-log");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-applog-"));
const log = createAppLog(tmp);

log.info("hello");
log.warn("careful");
log.error("boom\nline2");

const text = log.readAll();
assert.match(text, /\[info\] hello/);
assert.match(text, /\[warn\] careful/);
assert.match(text, /\[error\] boom/);
assert.match(text, /\| line2/);

const st = log.stats();
assert.strictEqual(st.path, path.join(tmp, "logs", "freeclaude.log"));
assert.ok(st.bytes > 0);

const smallTail = log.readTail();
assert.strictEqual(smallTail.truncated, false);
assert.strictEqual(smallTail.text, text);

for (let i = 0; i < 4000; i += 1) log.info(`filler line ${i} ${"x".repeat(80)}`);
const tail = log.readTail(16 * 1024);
assert.strictEqual(tail.truncated, true);
assert.ok(tail.text.length <= 16 * 1024, "tail respects the byte budget");
assert.ok(tail.bytes > 16 * 1024, "tail reports the real file size");
assert.match(tail.text, /filler line 3999/);
assert.doesNotMatch(tail.text, /\[info\] hello/);
// Cutting at the first newline keeps the first kept line whole.
assert.match(tail.text.split("\n")[0], /^\d{4}-\d{2}-\d{2}T/);

log.clear();
const after = log.readAll();
assert.match(after, /Log cleared by user/);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok   app-log append / read / tail / clear");
