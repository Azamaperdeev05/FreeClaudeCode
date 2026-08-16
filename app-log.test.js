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

log.clear();
const after = log.readAll();
assert.match(after, /Log cleared by user/);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok   app-log append / read / clear");
