"use strict";

const assert = require("assert");
const { toBatPath, toBatPathSafe, hasNonAscii } = require("./bat-path");

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

const env = {
  APPDATA: "C:\\Users\\ИмяПользователя\\AppData\\Roaming",
  LOCALAPPDATA: "C:\\Users\\ИмяПользователя\\AppData\\Local",
  USERPROFILE: "C:\\Users\\ИмяПользователя",
  ProgramFiles: "C:\\Program Files",
  ProgramW6432: "C:\\Program Files",
};

scenario("npm and profile become %APPDATA% / %USERPROFILE%", () => {
  assert.strictEqual(
    toBatPath("C:\\Users\\ИмяПользователя\\AppData\\Roaming\\npm", env),
    "%APPDATA%\\npm"
  );
  assert.strictEqual(
    toBatPath("C:\\Users\\ИмяПользователя\\AppData\\Roaming\\npm\\claude.cmd", env),
    "%APPDATA%\\npm\\claude.cmd"
  );
  assert.strictEqual(
    toBatPath("C:\\Users\\ИмяПользователя\\.claude\\profiles\\active-freeclaude", env),
    "%USERPROFILE%\\.claude\\profiles\\active-freeclaude"
  );
});

scenario("portable Node uses %LOCALAPPDATA%", () => {
  assert.strictEqual(
    toBatPath("C:\\Users\\ИмяПользователя\\AppData\\Local\\Programs\\node", env),
    "%LOCALAPPDATA%\\Programs\\node"
  );
});

scenario("Program Files Node uses %ProgramFiles%", () => {
  assert.strictEqual(toBatPath("C:\\Program Files\\nodejs", env), "%ProgramFiles%\\nodejs");
});

scenario("ASCII absolute paths stay absolute when outside known roots", () => {
  assert.strictEqual(toBatPath("D:\\tools\\node", env), "D:\\tools\\node");
});

scenario("non-ASCII leftovers fall back", () => {
  assert.strictEqual(hasNonAscii("C:\\Users\\Имя\\x"), true);
  assert.strictEqual(
    toBatPathSafe("D:\\Имя\\claude.cmd", "%APPDATA%\\npm\\claude.cmd", env),
    "%APPDATA%\\npm\\claude.cmd"
  );
});

process.exit(failed ? 1 : 0);
