const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const EXE_DIR = path.dirname(process.execPath);
const NODE = path.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs", "node.exe");
const BRIDGE = path.join(EXE_DIR, "sqlite-bridge.js");

function call(fn, args = []) {
  if (!fs.existsSync(NODE)) {
    throw new Error("Node.js не найден. Установи Node.js — он нужен для OmniRoute и ключей.");
  }
  if (!fs.existsSync(BRIDGE)) {
    throw new Error("sqlite-bridge.js не найден рядом с FreeClaude.exe");
  }
  const r = spawnSync(NODE, [BRIDGE, fn], {
    input: JSON.stringify(args),
    encoding: "utf8",
    windowsHide: true,
    cwd: EXE_DIR,
    env: process.env,
  });
  const out = String(r.stdout || "").trim();
  const err = String(r.stderr || "").trim();
  if (r.status !== 0) {
    let msg = err || out || `bridge exit ${r.status}`;
    try {
      const j = JSON.parse(out);
      if (j && j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return out ? JSON.parse(out) : null;
}

function formatDuration(ms) {
  const n = Math.max(0, Number(ms) || 0);
  const s = Math.floor(n / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м ${sec}с`;
  return `${sec}с`;
}

module.exports = {
  createApiKey: (name) => call("createApiKey", [name]),
  ensureApiKey: (name) => call("ensureApiKey", [name]),
  listApiKeys: () => call("listApiKeys"),
  getKiroStatus: () => call("getKiroStatus"),
  getKeyUsage: (token) => call("getKeyUsage", [token]),
  logoutKiro: (id) => call("logoutKiro", [id || null]),
  getAccountLimitInfo: () => call("getAccountLimitInfo"),
  formatDuration,
  DB_PATH: path.join(process.env.USERPROFILE || "", ".omniroute", "storage.sqlite"),
};
