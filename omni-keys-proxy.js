/**
 * pkg cannot load better-sqlite3's native addon, so every DB call is forwarded to
 * sqlite-bridge.js running under a real system Node.
 */
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const { resolveNode, nodeMajorVersion } = require("./node-resolve");

const EXE_DIR = path.dirname(process.execPath);
const BRIDGE = path.join(EXE_DIR, "sqlite-bridge.js");
const MIN_NODE_MAJOR = 22;
const CALL_TIMEOUT_MS = 20000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

let _checkedNode = null;

function requireNode() {
  if (_checkedNode) return _checkedNode;

  const node = resolveNode();
  if (!node) {
    throw new Error("Node.js не найден. Установи Node.js 22+ — он нужен для OmniRoute и ключей.");
  }

  const major = nodeMajorVersion(node);
  if (major !== null && major < MIN_NODE_MAJOR) {
    throw new Error(`Нужен Node.js ${MIN_NODE_MAJOR}+, а найден ${major}. Обнови Node.js.`);
  }

  _checkedNode = node;
  return node;
}

function call(fn, args = []) {
  const node = requireNode();
  if (!fs.existsSync(BRIDGE)) {
    throw new Error("sqlite-bridge.js не найден рядом с FreeClaude.exe");
  }

  const r = spawnSync(node, [BRIDGE, fn], {
    input: JSON.stringify(args),
    encoding: "utf8",
    windowsHide: true,
    cwd: EXE_DIR,
    env: process.env,
    timeout: CALL_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
  });

  if (r.error) {
    if (r.error.code === "ETIMEDOUT") {
      throw new Error("База OmniRoute не отвечает (возможно, занята). Попробуй ещё раз.");
    }
    throw new Error(`Не удалось запустить sqlite-bridge: ${r.error.message}`);
  }

  const out = String(r.stdout || "").trim();
  const err = String(r.stderr || "").trim();

  if (r.status !== 0) {
    let msg = err || out || `bridge exit ${r.status}`;
    try {
      const j = JSON.parse(out);
      if (j && j.error) msg = j.error;
    } catch {
      /* keep raw output as the message */
    }
    throw new Error(msg);
  }

  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`sqlite-bridge вернул неожиданный ответ: ${out.slice(0, 200)}`);
  }
}

module.exports = {
  createApiKey: (name) => call("createApiKey", [name]),
  ensureApiKey: (name) => call("ensureApiKey", [name]),
  listApiKeys: () => call("listApiKeys"),
  getKiroStatus: () => call("getKiroStatus"),
  getKeyUsage: (token) => call("getKeyUsage", [token]),
  logoutKiro: (id) => call("logoutKiro", [id || null]),
  getAccountLimitInfo: () => call("getAccountLimitInfo"),
  healKiroConnections: () => call("healKiroConnections"),
  hasKiroCredentials: () => call("hasKiroCredentials"),
  formatDuration: require("./format-duration"),
  DB_PATH: path.join(process.env.USERPROFILE || "", ".omniroute", "storage.sqlite"),
};
