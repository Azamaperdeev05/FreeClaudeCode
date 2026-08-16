"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  decodeProjectSlug,
  isSessionId,
  listClaudeSessions,
  summarizePrompt,
} = require("./claude-sessions");

function scenario(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

scenario("session id validation", () => {
  assert.strictEqual(isSessionId("da8a1b2f-efe9-4fd8-9702-320e5c363d4c"), true);
  assert.strictEqual(isSessionId("nope"), false);
});

scenario("project slug decode", () => {
  assert.strictEqual(decodeProjectSlug("C--Users-jen-AppData-Roaming-FreeClaude"), "C:\\Users\\jen\\AppData\\Roaming\\FreeClaude");
  assert.strictEqual(decodeProjectSlug("C--cbat"), "C:\\cbat");
});

scenario("prompt summary", () => {
  assert.strictEqual(summarizePrompt("hello"), "hello");
  assert.ok(summarizePrompt("x".repeat(200)).endsWith("…"));
});

scenario("list sessions from a fake tree", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fc-chats-"));
  const proj = path.join(root, "C--tmp-demo");
  fs.mkdirSync(proj, { recursive: true });
  const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const file = path.join(proj, `${id}.jsonl`);
  fs.writeFileSync(
    file,
    [
      JSON.stringify({ type: "mode", sessionId: id }),
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "fix the login bug" },
        cwd: "C:\\tmp\\demo",
      }),
      JSON.stringify({ type: "last-prompt", lastPrompt: "fix the login bug", sessionId: id }),
      "",
    ].join("\n"),
    "utf8"
  );

  const sessions = listClaudeSessions({ profileDir: root, homeClaude: path.join(root, "none"), limit: 10 });
  assert.strictEqual(sessions.length, 1);
  assert.strictEqual(sessions[0].id, id);
  assert.match(sessions[0].title, /fix the login bug/);
  fs.rmSync(root, { recursive: true, force: true });
});

console.log("all claude-sessions tests passed");
