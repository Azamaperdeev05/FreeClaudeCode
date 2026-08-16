"use strict";

/**
 * Read Claude Code session transcripts from disk (JSONL under projects/).
 * FreeClaude launches with CLAUDE_CONFIG_DIR=…/active-freeclaude, so that tree
 * is preferred; the default ~/.claude/projects is included as a fallback.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isSessionId(value) {
  return SESSION_ID_RE.test(String(value || "").trim());
}

/** Decode Claude's project folder slug: C--Users-jen-foo → C:\Users\jen\foo */
function decodeProjectSlug(slug) {
  const raw = String(slug || "").trim();
  if (!raw) return "";
  if (/^[A-Za-z]--/.test(raw)) {
    const drive = raw[0].toUpperCase();
    const rest = raw.slice(3).replace(/-/g, "\\");
    return `${drive}:\\${rest}`;
  }
  if (raw.startsWith("-")) {
    return raw.replace(/-/g, path.sep);
  }
  return raw.replace(/-/g, path.sep);
}

function textFromContent(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (!block) continue;
    if (typeof block === "string") parts.push(block);
    else if (typeof block.text === "string") parts.push(block.text);
    else if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join(" ").trim();
}

function summarizePrompt(text, max = 90) {
  const one = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!one) return "";
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

function readSessionMeta(filePath, sessionId, projectSlug, source) {
  let firstPrompt = "";
  let lastPrompt = "";
  let cwd = "";
  let named = "";
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(96 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      const head = buf.slice(0, n).toString("utf8");
      for (const line of head.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let row;
        try {
          row = JSON.parse(line);
        } catch {
          continue;
        }
        if (!cwd && typeof row.cwd === "string" && row.cwd) cwd = row.cwd;
        if (!named && typeof row.sessionName === "string" && row.sessionName) named = row.sessionName;
        if (!named && typeof row.name === "string" && row.name && row.type === "session") named = row.name;
        if (row.type === "last-prompt" && row.lastPrompt) {
          lastPrompt = String(row.lastPrompt);
        }
        if (!firstPrompt && row.type === "user" && row.message) {
          const t = textFromContent(row.message.content);
          if (t && !t.startsWith("<")) firstPrompt = t;
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    /* unreadable */
  }

  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    mtimeMs = 0;
  }

  const decoded = decodeProjectSlug(projectSlug);
  if (!cwd && decoded && fs.existsSync(decoded)) cwd = decoded;

  const title = summarizePrompt(named || lastPrompt || firstPrompt) || sessionId.slice(0, 8);

  return {
    id: sessionId,
    title,
    project: projectSlug,
    cwd: cwd || decoded || "",
    source,
    mtimeMs,
    mtime: mtimeMs ? new Date(mtimeMs).toISOString() : null,
  };
}

function collectFromRoot(root, source, out) {
  if (!root || !fs.existsSync(root)) return;
  let projects;
  try {
    projects = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const dirent of projects) {
    if (!dirent.isDirectory()) continue;
    const projectSlug = dirent.name;
    const projectDir = path.join(root, projectSlug);
    let files;
    try {
      files = fs.readdirSync(projectDir);
    } catch {
      continue;
    }
    for (const name of files) {
      if (!name.endsWith(".jsonl")) continue;
      const id = name.slice(0, -".jsonl".length);
      if (!isSessionId(id)) continue;
      if (out.has(id)) continue;
      const full = path.join(projectDir, name);
      out.set(id, readSessionMeta(full, id, projectSlug, source));
    }
  }
}

/**
 * @param {{ profileDir?: string, homeClaude?: string, limit?: number }} opts
 */
function listClaudeSessions(opts = {}) {
  const home = process.env.USERPROFILE || os.homedir();
  const profileDir =
    opts.profileDir || path.join(home, ".claude", "profiles", "active-freeclaude", "projects");
  const homeClaude = opts.homeClaude || path.join(home, ".claude", "projects");
  const limit = Math.min(80, Math.max(1, Number(opts.limit) || 25));

  const map = new Map();
  collectFromRoot(profileDir, "freeclaude", map);
  collectFromRoot(homeClaude, "claude", map);

  return [...map.values()]
    .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0))
    .slice(0, limit)
    .map(({ mtimeMs, ...rest }) => rest);
}

module.exports = {
  listClaudeSessions,
  decodeProjectSlug,
  isSessionId,
  SESSION_ID_RE,
  summarizePrompt,
};
