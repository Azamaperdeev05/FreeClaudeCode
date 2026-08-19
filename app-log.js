"use strict";

/**
 * Persistent FreeClaude log under %APPDATA%\\FreeClaude\\logs.
 * Append-only for the lifetime of the install — the Logs tab and download
 * read this file as-is, with no ring-buffer trimming.
 */

const fs = require("fs");
const path = require("path");

const LEVELS = new Set(["info", "warn", "error", "debug"]);

function createAppLog(dataDir) {
  const root = String(dataDir || "").trim();
  if (!root) throw new Error("app-log: dataDir required");

  const logDir = path.join(root, "logs");
  const logFile = path.join(logDir, "freeclaude.log");

  function ensureDir() {
    fs.mkdirSync(logDir, { recursive: true });
  }

  function formatLine(level, message) {
    const lvl = LEVELS.has(level) ? level : "info";
    const ts = new Date().toISOString();
    const body = String(message == null ? "" : message);
    // Keep newlines readable in the file; prefix every physical line with the stamp.
    const lines = body.split(/\r\n|\n|\r/);
    if (lines.length <= 1) return `${ts} [${lvl}] ${body}\n`;
    return lines.map((part, i) => `${ts} [${lvl}] ${i === 0 ? part : `  | ${part}`}`).join("\n") + "\n";
  }

  function append(level, message) {
    try {
      ensureDir();
      fs.appendFileSync(logFile, formatLine(level, message), "utf8");
    } catch {
      /* never break the app because logging failed */
    }
  }

  function info(message) {
    append("info", message);
  }
  function warn(message) {
    append("warn", message);
  }
  function error(message) {
    append("error", message);
  }
  function debug(message) {
    append("debug", message);
  }

  function exists() {
    try {
      return fs.existsSync(logFile);
    } catch {
      return false;
    }
  }

  function stats() {
    try {
      if (!exists()) return { path: logFile, bytes: 0, mtime: null };
      const st = fs.statSync(logFile);
      return { path: logFile, bytes: st.size, mtime: st.mtime.toISOString() };
    } catch {
      return { path: logFile, bytes: 0, mtime: null };
    }
  }

  /** Full file contents — no truncation. */
  function readAll() {
    try {
      if (!exists()) return "";
      return fs.readFileSync(logFile, "utf8");
    } catch (err) {
      return `[app-log] failed to read: ${err && err.message ? err.message : err}\n`;
    }
  }

  /**
   * Last `maxBytes` of the file, cut at a line boundary. The Logs tab polls every 2s and
   * the file only ever grows, so re-reading all of it got slower the longer the app ran.
   */
  function readTail(maxBytes = 256 * 1024) {
    const limit = Math.max(4096, Number(maxBytes) || 0);
    try {
      if (!exists()) return { text: "", truncated: false, bytes: 0 };
      const size = fs.statSync(logFile).size;
      if (size <= limit) return { text: readAll(), truncated: false, bytes: size };
      const fd = fs.openSync(logFile, "r");
      try {
        const buf = Buffer.alloc(limit);
        const n = fs.readSync(fd, buf, 0, limit, size - limit);
        const chunk = buf.slice(0, n).toString("utf8");
        const nl = chunk.indexOf("\n");
        return { text: nl >= 0 ? chunk.slice(nl + 1) : chunk, truncated: true, bytes: size };
      } finally {
        fs.closeSync(fd);
      }
    } catch (err) {
      return {
        text: `[app-log] failed to read: ${err && err.message ? err.message : err}\n`,
        truncated: false,
        bytes: 0,
      };
    }
  }

  function clear() {
    ensureDir();
    fs.writeFileSync(logFile, "", "utf8");
    info("Log cleared by user");
  }

  /**
   * Mirror console.error / console.warn into the persistent file without changing
   * their normal console output.
   */
  function mirrorConsole() {
    for (const method of ["error", "warn"]) {
      const original = console[method].bind(console);
      console[method] = (...args) => {
        try {
          const text = args
            .map((a) => {
              if (typeof a === "string") return a;
              if (a instanceof Error) return a.stack || a.message;
              try {
                return JSON.stringify(a);
              } catch {
                return String(a);
              }
            })
            .join(" ");
          append(method === "warn" ? "warn" : "error", text);
        } catch {
          /* ignore */
        }
        return original(...args);
      };
    }

    process.on("uncaughtException", (err) => {
      append("error", `uncaughtException: ${err && err.stack ? err.stack : err}`);
    });
    process.on("unhandledRejection", (reason) => {
      const text =
        reason instanceof Error
          ? reason.stack || reason.message
          : typeof reason === "string"
            ? reason
            : (() => {
                try {
                  return JSON.stringify(reason);
                } catch {
                  return String(reason);
                }
              })();
      append("error", `unhandledRejection: ${text}`);
    });
  }

  return {
    logDir,
    logFile,
    append,
    info,
    warn,
    error,
    debug,
    readAll,
    readTail,
    clear,
    stats,
    exists,
    mirrorConsole,
  };
}

module.exports = { createAppLog };
