const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, spawnSync, execFile, execFileSync } = require("child_process");
const { URL } = require("url");
const { promisify } = require("util");
const omniKeys = process.pkg ? require("./omni-keys-proxy") : require("./omni-keys");

const execFileAsync = promisify(execFile);

const PORT = 3847;
const OMNI = "http://127.0.0.1:20128";
const SETTINGS = path.join(process.env.USERPROFILE || os.homedir(), ".claude", "settings.json");
const PROFILE_DIR = path.join(process.env.USERPROFILE || os.homedir(), ".claude", "profiles", "active-freeclaude");
const IS_PKG = Boolean(process.pkg);
const EXE_DIR = IS_PKG ? path.dirname(process.execPath) : __dirname;
const DATA_DIR = (() => {
  const dir = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "FreeClaude");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  return dir;
})();
const CONFIG = path.join(DATA_DIR, "config.json");
const FREECLAUDE = path.join(DATA_DIR, "freeclaude.bat");
const PUBLIC = path.join(__dirname, "public");
const NODE_DIR_DEFAULT = "C:\\Program Files\\nodejs";
const NPM_BIN = path.join(process.env.APPDATA || "", "npm");
const WINGET = path.join(process.env.LOCALAPPDATA || "", "Microsoft\\WindowsApps\\winget.exe");
const ACCESS_URL = "https://pastebin.com/raw/rJp7g0eB";
const TELEGRAM_URL = "https://t.me/loveaideep";
const AWS_SIGNOUT_URL = "https://view.awsapps.com/start/#/signout";
const AWS_PORTAL_URL = "https://view.awsapps.com/start";

/** Cached resolved paths — GUI apps often miss user PATH that cmd.exe has. */
let _nodePathCache = undefined;
let _npmPathCache = undefined;
let _winPathCache = null;
let _winPathCachedAt = 0;

function readWindowsUserMachinePath() {
  if (_winPathCache && Date.now() - _winPathCachedAt < 60_000) return _winPathCache;
  try {
    const r = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 10000 }
    );
    _winPathCache = String(r.stdout || "").trim();
  } catch {
    _winPathCache = "";
  }
  _winPathCachedAt = Date.now();
  return _winPathCache;
}

function enrichedPath() {
  const parts = [
    NODE_DIR_DEFAULT,
    process.env.NVM_SYMLINK || "",
    process.env.NVM_HOME || "",
    NPM_BIN,
    process.env.PATH || "",
    readWindowsUserMachinePath(),
  ].filter(Boolean);
  return parts.join(";");
}

function whereOnPath(name) {
  try {
    const r = spawnSync("where.exe", [name], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 8000,
      env: { ...process.env, PATH: enrichedPath() },
    });
    const lines = String(r.stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const line of lines) {
      if (fs.existsSync(line)) return line;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function invalidateToolCache() {
  _nodePathCache = undefined;
  _npmPathCache = undefined;
}

function resolveNode() {
  if (_nodePathCache !== undefined) {
    if (_nodePathCache && fs.existsSync(_nodePathCache)) return _nodePathCache;
    _nodePathCache = undefined;
  }

  const driveCandidates = [];
  for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
    for (const base of [`${letter}:\\Program Files`, `${letter}:\\Program Files (x86)`]) {
      for (const name of ["nodejs", "Nodejs", "Node.js", "node"]) {
        driveCandidates.push(path.join(base, name, "node.exe"));
      }
    }
  }

  const candidates = [
    path.join(NODE_DIR_DEFAULT, "node.exe"),
    process.env.NVM_SYMLINK ? path.join(process.env.NVM_SYMLINK, "node.exe") : null,
    path.join(process.env.LOCALAPPDATA || "", "Programs", "node", "node.exe"),
    path.join(os.homedir(), "scoop", "apps", "nodejs", "current", "node.exe"),
    path.join(os.homedir(), "scoop", "apps", "nodejs-lts", "current", "node.exe"),
    ...driveCandidates,
    whereOnPath("node.exe"),
    whereOnPath("node"),
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) {
        _nodePathCache = c;
        return c;
      }
    } catch {
      /* ignore */
    }
  }
  _nodePathCache = null;
  return null;
}

function resolveNpm() {
  if (_npmPathCache !== undefined) {
    if (_npmPathCache && fs.existsSync(_npmPathCache)) return _npmPathCache;
    _npmPathCache = undefined;
  }
  const node = resolveNode();
  const besideNode = node ? path.join(path.dirname(node), "npm.cmd") : null;
  // Prefer npm next to node.exe (E:\Program Files\Nodejs) over %APPDATA%\npm shims
  const candidates = [
    besideNode,
    path.join(NODE_DIR_DEFAULT, "npm.cmd"),
    process.env.NVM_SYMLINK ? path.join(process.env.NVM_SYMLINK, "npm.cmd") : null,
    path.join(os.homedir(), "scoop", "apps", "nodejs", "current", "npm.cmd"),
    path.join(os.homedir(), "scoop", "apps", "nodejs-lts", "current", "npm.cmd"),
    whereOnPath("npm.cmd"),
    whereOnPath("npm"),
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) {
        _npmPathCache = c;
        return c;
      }
    } catch {
      /* ignore */
    }
  }
  _npmPathCache = null;
  return null;
}

function nodeDir() {
  const n = resolveNode();
  return n ? path.dirname(n) : NODE_DIR_DEFAULT;
}

// Packaged EXE: do not auto-spawn a browser from inside pkg (causes 0xC0000005).
// Use FreeClaude.cmd launcher, or open http://127.0.0.1:3847 manually.
const openApp = process.argv.includes("--app");

const accessCache = {
  checkedAt: 0,
  allowed: true,
  raw: "1",
  error: null,
};

const installState = {
  running: false,
  step: "",
  log: [],
  ok: null,
  finishedAt: null,
  cancelRequested: false,
  child: null,
};

/** In-memory AWS Builder ID device-code session (OmniRoute dashboard login skipped). */
const kiroOAuth = {
  cookie: null,
  deviceCode: null,
  codeVerifier: null,
  extraData: null,
  expiresAt: 0,
  interval: 5,
  userCode: null,
  verificationUri: null,
  verificationUriComplete: null,
};

function getOmniPassword() {
  const cfg = readConfig();
  return (
    process.env.INITIAL_PASSWORD ||
    process.env.OMNIROUTE_PASSWORD ||
    cfg.omniPassword ||
    "CHANGEME"
  );
}

function readOmniEnvFile() {
  const envPath = path.join(os.homedir(), ".omniroute", ".env");
  const out = {};
  try {
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 1) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[k] = v;
    }
  } catch {
    /* no .env */
  }
  return out;
}

function candidateOmniPasswords() {
  const cfg = readConfig();
  const envFile = readOmniEnvFile();
  const list = [
    process.env.INITIAL_PASSWORD,
    process.env.OMNIROUTE_PASSWORD,
    cfg.omniPassword,
    envFile.INITIAL_PASSWORD,
    envFile.OMNIROUTE_PASSWORD,
    envFile.DASHBOARD_PASSWORD,
    envFile.PASSWORD,
    "CHANGEME",
    "changeme",
    "admin",
    "password",
    "omniroute",
  ];
  const seen = new Set();
  const out = [];
  for (const p of list) {
    if (p == null || p === "") continue;
    const s = String(p);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function cookieFromSetCookie(setCookie) {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const raw of list) {
    const m = String(raw || "").match(/auth_token=([^;]+)/);
    if (m) return `auth_token=${m[1]}`;
  }
  return null;
}

async function tryOmniLogin(password) {
  const res = await fetch(`${OMNI}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(15000),
  });
  const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const cookie = cookieFromSetCookie(setCookie) || cookieFromSetCookie(res.headers.get("set-cookie"));
  const text = await res.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  return { ok: res.ok && Boolean(cookie), status: res.status, cookie, text, json };
}

async function loginOmniDashboard() {
  let lastMsg = "";
  for (const password of candidateOmniPasswords()) {
    try {
      const r = await tryOmniLogin(password);
      if (r.ok && r.cookie) {
        try {
          writeConfig({ omniPassword: password });
        } catch {
          /* ignore */
        }
        return r.cookie;
      }
      lastMsg =
        (r.json && (r.json.error || r.json.message)) ||
        r.text ||
        `login failed (${r.status})`;
    } catch (err) {
      lastMsg = String(err.message || err);
    }
  }
  const pretty =
    /invalid password/i.test(String(lastMsg))
      ? "Неверный пароль панели OmniRoute. Открой http://127.0.0.1:20128 и проверь пароль (часто CHANGEME), либо задай OMNIROUTE_PASSWORD."
      : String(lastMsg || "OmniRoute login failed");
  throw new Error(pretty);
}

async function startKiroBuilderIdFlow() {
  if (!(await ensureOmni(60000))) {
    throw new Error("OmniRoute не запущен");
  }
  const cookie = await loginOmniDashboard();
  const dcRes = await fetch(`${OMNI}/api/oauth/kiro/device-code`, {
    headers: { Cookie: cookie, Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  const data = await dcRes.json().catch(() => ({}));
  if (!dcRes.ok || !data.device_code) {
    throw new Error(data.error || data.message || `device-code failed (${dcRes.status})`);
  }

  kiroOAuth.cookie = cookie;
  kiroOAuth.deviceCode = data.device_code;
  kiroOAuth.codeVerifier = data.codeVerifier || null;
  kiroOAuth.extraData = {
    _clientId: data._clientId,
    _clientSecret: data._clientSecret,
    _region: data._region || "us-east-1",
    _authMethod: data._authMethod || "builder-id",
  };
  kiroOAuth.interval = Math.max(3, Number(data.interval) || 5);
  kiroOAuth.expiresAt = Date.now() + Math.max(60, Number(data.expires_in) || 600) * 1000;
  kiroOAuth.userCode = data.user_code || null;
  kiroOAuth.verificationUri = data.verification_uri || "https://view.awsapps.com/start/#/device";
  kiroOAuth.verificationUriComplete =
    data.verification_uri_complete ||
    (kiroOAuth.userCode
      ? `https://view.awsapps.com/start/#/device?user_code=${encodeURIComponent(kiroOAuth.userCode)}`
      : kiroOAuth.verificationUri);

  return {
    userCode: kiroOAuth.userCode,
    verificationUri: kiroOAuth.verificationUri,
    verificationUriComplete: kiroOAuth.verificationUriComplete,
    expiresIn: Math.max(0, Math.floor((kiroOAuth.expiresAt - Date.now()) / 1000)),
    interval: kiroOAuth.interval,
  };
}

async function pollKiroBuilderIdOnce() {
  if (!kiroOAuth.cookie || !kiroOAuth.deviceCode || !kiroOAuth.extraData) {
    return { success: false, pending: false, error: "no_session", errorDescription: "Сначала нажми «Войти в Kiro»" };
  }
  if (Date.now() > kiroOAuth.expiresAt) {
    return { success: false, pending: false, error: "expired", errorDescription: "Код истёк — начни вход заново" };
  }

  const body = {
    deviceCode: kiroOAuth.deviceCode,
    codeVerifier: kiroOAuth.codeVerifier,
    extraData: kiroOAuth.extraData,
  };
  const res = await fetch(`${OMNI}/api/oauth/kiro/poll`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: kiroOAuth.cookie,
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (data.success) {
    kiroOAuth.cookie = null;
    kiroOAuth.deviceCode = null;
    kiroOAuth.extraData = null;
  }
  return {
    success: Boolean(data.success),
    pending: Boolean(data.pending) || data.error === "authorization_pending" || data.error === "slow_down",
    error: data.error || null,
    errorDescription: data.errorDescription || data.error_description || null,
    slowDown: data.error === "slow_down",
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function countKiroModels() {
  try {
    const r = await omniFetch("/v1/models");
    if (!r.ok) return 0;
    const all = r.json?.data || [];
    return all.filter((m) => /^(kiro|kr)\//i.test(m.id || "")).length;
  } catch {
    return 0;
  }
}

/**
 * После AWS «Request approved» OmniRoute ещё секунды пишет токены / каталог моделей.
 * Ждём готовность, иначе UI показывает «не авторизован» и пустой список.
 */
async function finalizeKiroAuth() {
  const started = Date.now();
  const timeoutMs = 25000;
  let keyIssued = null;
  let healed = 0;
  let modelsCount = 0;
  let connected = false;

  // Ключ сразу — /v1/models часто требует Bearer
  try {
    let created;
    if (!readToken()) {
      created = omniKeys.createApiKey(
        `freeclaude-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}`
      );
    } else {
      created = omniKeys.ensureApiKey(
        `freeclaude-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}`
      );
    }
    const model = readActiveModel() || "kiro/claude-sonnet-4.5";
    writeSettings(model, created.key);
    keyIssued = { masked: created.masked, reused: Boolean(created.reused), fresh: !created.reused };
  } catch (err) {
    keyIssued = { error: String(err.message || err) };
  }

  while (Date.now() - started < timeoutMs) {
    try {
      const h = omniKeys.healKiroConnections();
      healed = Math.max(healed, Number(h?.healed || 0));
    } catch {
      /* ignore */
    }

    try {
      const lim = omniKeys.getAccountLimitInfo();
      connected = Boolean(lim?.connected) || Boolean(omniKeys.hasKiroCredentials?.());
    } catch {
      try {
        connected = Boolean(omniKeys.hasKiroCredentials());
      } catch {
        connected = false;
      }
    }

    modelsCount = await countKiroModels();
    if (connected && modelsCount > 0) break;
    // Есть креды, но каталог ещё пустой — подождём
    if (connected && Date.now() - started > 8000 && modelsCount === 0) {
      // продолжаем до таймаута
    }
    await sleep(900);
  }

  // финальный heal + status
  try {
    omniKeys.healKiroConnections();
    const lim = omniKeys.getAccountLimitInfo();
    connected = Boolean(lim?.connected) || Boolean(omniKeys.hasKiroCredentials());
  } catch {
    /* ignore */
  }
  modelsCount = await countKiroModels();

  return {
    keyIssued,
    ready: Boolean(connected && modelsCount > 0),
    kiroConnected: Boolean(connected),
    modelsCount,
    healed,
    waitedMs: Date.now() - started,
  };
}

function clearKiroOAuthSession() {
  kiroOAuth.cookie = null;
  kiroOAuth.deviceCode = null;
  kiroOAuth.codeVerifier = null;
  kiroOAuth.extraData = null;
  kiroOAuth.expiresAt = 0;
  kiroOAuth.userCode = null;
  kiroOAuth.verificationUri = null;
  kiroOAuth.verificationUriComplete = null;
}

function openUrlApp(url) {
  const browser = findBrowser();
  if (browser) {
    try {
      const child = spawn(browser, [`--app=${url}`, "--new-window", "--window-size=980,820"], {
        detached: true,
        stdio: "ignore",
      });
      child.on("error", () => {});
      child.unref();
      return true;
    } catch {
      /* fall through */
    }
  }
  try {
    const child = spawn(
      process.env.ComSpec || "cmd.exe",
      ["/c", "start", "", url],
      { detached: true, stdio: "ignore", windowsHide: true }
    );
    child.on("error", () => {});
    child.unref();
  } catch (err) {
    console.error("openUrlApp failed:", err && err.message ? err.message : err);
  }
  return true;
}

/** Fresh AWS session: ephemeral Chrome/Edge profile so Builder ID cookies are not reused. */
function openAwsAuthWindow(deviceUrl, { fresh = true } = {}) {
  const browser = findBrowser();
  const target = deviceUrl || AWS_PORTAL_URL;
  if (!browser) {
    openUrlApp(target);
    return { ok: true, mode: "shell", url: target };
  }

  if (!fresh) {
    openUrlApp(target);
    return { ok: true, mode: "app", url: target };
  }

  const profileDir = path.join(os.tmpdir(), `freeclaude-aws-${Date.now()}`);
  fs.mkdirSync(profileDir, { recursive: true });
  spawn(
    browser,
    [
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate",
      `--app=${target}`,
      "--window-size=980,820",
    ],
    { detached: true, stdio: "ignore" }
  ).unref();

  // Best-effort cleanup of old ephemeral profiles (older than 2 days)
  try {
    const tmp = os.tmpdir();
    for (const name of fs.readdirSync(tmp)) {
      if (!name.startsWith("freeclaude-aws-")) continue;
      const full = path.join(tmp, name);
      try {
        const st = fs.statSync(full);
        if (Date.now() - st.mtimeMs > 2 * 24 * 60 * 60 * 1000) {
          fs.rmSync(full, { recursive: true, force: true });
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }

  return { ok: true, mode: "fresh-profile", url: target, profileDir };
}

function openAwsSignOut() {
  return openAwsAuthWindow(AWS_SIGNOUT_URL, { fresh: true });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function checkAccess(force = false) {
  const now = Date.now();
  if (!force && accessCache.checkedAt && now - accessCache.checkedAt < 60_000) {
    return {
      allowed: accessCache.allowed,
      raw: accessCache.raw,
      telegram: TELEGRAM_URL,
      cached: true,
      error: accessCache.error,
    };
  }
  try {
    const res = await fetch(ACCESS_URL, {
      headers: {
        "User-Agent": "FreeClaude/1.0",
        Accept: "text/plain",
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(10000),
    });
    const text = (await res.text()).trim();
    const token = text.split(/\s+/)[0] || "";
    const allowed = token === "1";
    accessCache.checkedAt = now;
    accessCache.allowed = allowed;
    accessCache.raw = token;
    accessCache.error = res.ok ? null : `HTTP ${res.status}`;
    return {
      allowed,
      raw: token,
      telegram: TELEGRAM_URL,
      cached: false,
      error: accessCache.error,
    };
  } catch (err) {
    // Сеть недоступна — не блокируем локальную работу, но отдаём ошибку для UI при желании
    accessCache.checkedAt = now;
    accessCache.allowed = true;
    accessCache.raw = accessCache.raw || "1";
    accessCache.error = String(err.message || err);
    return {
      allowed: true,
      raw: accessCache.raw,
      telegram: TELEGRAM_URL,
      cached: false,
      offline: true,
      error: accessCache.error,
    };
  }
}

function accessDeniedPayload() {
  return {
    ok: false,
    allowed: false,
    updateRequired: true,
    error: "Вышло обновление. Скачайте в Telegram.",
    telegram: TELEGRAM_URL,
  };
}

function whichExists(file) {
  return Boolean(file && fs.existsSync(file));
}

function claudeNativeBin() {
  return path.join(NPM_BIN, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
}

/** Real Claude Code binary — not the 500-byte postinstall stub. */
function isClaudeCodeReady() {
  const cmd = path.join(NPM_BIN, "claude.cmd");
  const bin = claudeNativeBin();
  if (!whichExists(cmd) || !whichExists(bin)) return false;
  try {
    const st = fs.statSync(bin);
    // Stub is a tiny echo script; real win32 PE is multi‑MB.
    if (st.size < 100_000) return false;
    const fd = fs.openSync(bin, "r");
    const buf = Buffer.alloc(2);
    fs.readSync(fd, buf, 0, 2, 0);
    fs.closeSync(fd);
    return buf[0] === 0x4d && buf[1] === 0x5a; // MZ
  } catch {
    return false;
  }
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.writeFileSync(CONFIG, JSON.stringify(next, null, 2));
  return next;
}

function readToken() {
  const cfg = readConfig();
  if (cfg.apiKey) return cfg.apiKey;
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
    return s?.env?.ANTHROPIC_AUTH_TOKEN || "";
  } catch {
    return "";
  }
}

function maskToken(token) {
  if (!token) return "";
  if (token.length <= 10) return "***";
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

function readActiveModel() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
    return s?.model || s?.env?.ANTHROPIC_MODEL || "";
  } catch {
    return readConfig().model || "";
  }
}

async function isOmniUp() {
  try {
    const r = await fetch(`${OMNI}/api/monitoring/health`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

let omniChild = null;
let omniStopping = false;
let omniOwned = false; // true if FreeClaude should kill :20128 on exit

function stopOmniRoute() {
  if (omniStopping) return;
  omniStopping = true;
  try {
    if (omniChild && omniChild.pid) {
      try {
        spawnSync("taskkill", ["/PID", String(omniChild.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
          timeout: 8000,
        });
      } catch {
        try {
          omniChild.kill();
        } catch {
          /* ignore */
        }
      }
      omniChild = null;
    }
    // Всегда добиваем слушателей :20128 и node/omniroute serve — иначе сироты жрут CPU/лагает мышь
    try {
      const ps = [
        "$ErrorActionPreference='SilentlyContinue'",
        "$pids = @()",
        "Get-NetTCPConnection -LocalPort 20128 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $pids += $_.OwningProcess }",
        "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {",
        "  $_.Name -match '^(node|omniroute)' -and $_.CommandLine -match 'omniroute|20128|serve'",
        "} | ForEach-Object { $pids += $_.ProcessId }",
        "$pids = $pids | Where-Object { $_ -and $_ -gt 0 } | Select-Object -Unique",
        "foreach ($procId in $pids) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }",
      ].join("; ");
      spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
        windowsHide: true,
        stdio: "ignore",
        timeout: 15000,
      });
    } catch {
      /* ignore */
    }
    // fallback without PowerShell NetTCP
    try {
      spawnSync(
        process.env.ComSpec || "cmd.exe",
        [
          "/d",
          "/c",
          'for /f "tokens=5" %a in (\'netstat -ano ^| findstr :20128 ^| findstr LISTENING\') do taskkill /F /PID %a >nul 2>&1',
        ],
        { windowsHide: true, stdio: "ignore", timeout: 8000 }
      );
    } catch {
      /* ignore */
    }
  } finally {
    omniOwned = false;
    omniStopping = false;
  }
}

function installOmniShutdownHooks() {
  if (installOmniShutdownHooks.done) return;
  installOmniShutdownHooks.done = true;
  const bye = () => {
    try {
      if (omniOwned || omniChild) stopOmniRoute();
    } catch {
      /* ignore */
    }
  };
  process.on("exit", bye);
  // Windows console close / pkg exit
  try {
    process.on("beforeExit", bye);
  } catch {
    /* ignore */
  }
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
    try {
      process.on(sig, () => {
        bye();
        process.exit(0);
      });
    } catch {
      /* unsupported on platform */
    }
  }
  // Last-chance: poll if parent gone (when launched oddly)
  try {
    setInterval(() => {
      /* keep event loop aware; actual kill is on signals/exit */
    }, 60_000).unref?.();
  } catch {
    /* ignore */
  }
}

function startOmniRoute() {
  const mjs = path.join(NPM_BIN, "node_modules", "omniroute", "bin", "omniroute.mjs");
  const omniCmd = path.join(NPM_BIN, "omniroute.cmd");
  if (!whichExists(mjs) && !whichExists(omniCmd)) return;

  const env = {
    ...process.env,
    PATH: `${nodeDir()};${NPM_BIN};${enrichedPath()}`,
  };

  // OmniRoute — дочерний процесс FreeClaude (не detached-сирота).
  // При закрытии FreeClaude убиваем OmniRoute.
  try {
    if (omniChild && omniChild.exitCode == null) {
      return;
    }

    installOmniShutdownHooks();

    console.log("");
    console.log("────────────────────────────────────────");
    console.log("  OmniRoute  ·  вместе с FreeClaude");
    console.log("  Закроете FreeClaude — OmniRoute тоже");
    console.log(`  ${OMNI}`);
    console.log("────────────────────────────────────────");
    console.log("");

    let child;
    const nodeBin = resolveNode();
    if (nodeBin && whichExists(mjs)) {
      child = spawn(nodeBin, [mjs, "serve", "--no-open"], {
        detached: false,
        stdio: "ignore",
        windowsHide: true,
        env,
        cwd: path.join(NPM_BIN, "node_modules", "omniroute"),
      });
    } else {
      child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/c", omniCmd, "serve", "--no-open"], {
        detached: false,
        stdio: "ignore",
        windowsHide: true,
        env,
      });
    }
    omniChild = child;
    omniOwned = true;
    child.on("error", (err) => console.error("OmniRoute spawn error:", err.message));
    child.on("exit", (code) => {
      if (omniChild === child) omniChild = null;
      console.log(`OmniRoute stopped (code ${code})`);
    });
  } catch (err) {
    console.error("OmniRoute start failed:", err && err.message ? err.message : err);
  }
}

async function ensureOmni(timeoutMs = 90000, opts = {}) {
  try {
    installOmniShutdownHooks();
    if (await isOmniUp()) {
      // Даже чужой/старый OmniRoute считаем «нашим» для cleanup при выходе
      omniOwned = true;
      if (opts.liveLog) pushLog("OmniRoute уже online");
      return true;
    }
    if (!whichExists(path.join(NPM_BIN, "omniroute.cmd")) && !whichExists(path.join(NPM_BIN, "node_modules", "omniroute", "bin", "omniroute.mjs"))) {
      return false;
    }
    if (opts.liveLog) pushLog("Поднимаю OmniRoute…");
    startOmniRoute();
    omniOwned = true;
    const start = Date.now();
    let lastBeat = 0;
    while (Date.now() - start < timeoutMs) {
      if (opts.checkCancel && installState.cancelRequested) {
        if (opts.liveLog) pushLog("Ожидание OmniRoute прервано");
        return false;
      }
      await sleep(500);
      if (await isOmniUp()) {
        if (opts.liveLog) pushLog(`OmniRoute online за ${Math.round((Date.now() - start) / 1000)}с`);
        return true;
      }
      if (opts.liveLog) {
        const sec = Math.round((Date.now() - start) / 1000);
        if (sec >= 3 && sec - lastBeat >= 5) {
          lastBeat = sec;
          pushLog(`Жду OmniRoute… ${sec}с`);
        }
      }
    }
    if (opts.liveLog) pushLog("OmniRoute не поднялся за отведённое время — смотри Настройки / перезапуск");
    return false;
  } catch (err) {
    console.error("ensureOmni failed:", err && err.message ? err.message : err);
    if (opts.liveLog) pushLog(`OmniRoute: ${err && err.message ? err.message : err}`);
    return false;
  }
}

function writeBat(model, token) {
  const bat = `@echo off
setlocal EnableExtensions
set "PATH=${nodeDir()};%APPDATA%\\npm;%PATH%"
set "ANTHROPIC_AUTH_TOKEN=${token}"
set "OMNIROUTE_API_KEY=${token}"
set "OMNIROUTE=%APPDATA%\\npm\\omniroute.cmd"

echo Checking OmniRoute...
curl.exe -s -o NUL "${OMNI}/api/monitoring/health"
if errorlevel 1 (
  echo.
  echo [ERROR] OmniRoute offline.
  echo Сначала запусти FreeClaude.exe — он поднимает OmniRoute.
  echo Не запускаем OmniRoute отдельно, чтобы он не висел сиротой.
  echo.
  pause
  exit /b 1
)

if not exist "%OMNIROUTE%" (
  echo [ERROR] omniroute.cmd not found
  pause
  exit /b 1
)

echo Launching Claude Code with ${model}...
call "%OMNIROUTE%" launch --profile active-freeclaude --token "%ANTHROPIC_AUTH_TOKEN%" %*
set "EC=%ERRORLEVEL%"
if not "%EC%"=="0" (
  echo.
  echo [ERROR] Claude exit code: %EC%
  pause
)
exit /b %EC%
`;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FREECLAUDE, bat);
}

function writeSettings(model, token) {
  const haiku = /haiku/i.test(model) ? model : "kiro/claude-haiku-4.5";
  const settings = {
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    model,
    env: {
      ANTHROPIC_BASE_URL: "http://localhost:20128",
      ANTHROPIC_AUTH_TOKEN: token,
      ANTHROPIC_MODEL: model,
      ANTHROPIC_SMALL_FAST_MODEL: haiku,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: haiku,
      CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: "190000",
    },
  };
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  fs.writeFileSync(path.join(PROFILE_DIR, "settings.json"), JSON.stringify(settings, null, 2));
  writeConfig({ apiKey: token, model });
  writeBat(model, token);
}

async function runCmd(command, args, opts = {}) {
  if (opts.track && installState.cancelRequested) throw new Error("Установка остановлена");

  const nodeBin = resolveNode();
  const npmBin = resolveNpm();
  const env = {
    ...process.env,
    PATH: `${nodeDir()};${NPM_BIN};${enrichedPath()}`,
    ...(opts.env || {}),
  };

  let file = command;
  let finalArgs = args;
  const npmCli = path.join(nodeDir(), "node_modules", "npm", "bin", "npm-cli.js");
  if (
    process.platform === "win32" &&
    nodeBin &&
    ((npmBin && command === npmBin) || /[\\/]npm\.cmd$/i.test(String(command))) &&
    whichExists(npmCli)
  ) {
    file = nodeBin;
    finalArgs = [npmCli, ...args];
  } else if (process.platform === "win32" && /\.(cmd|bat)$/i.test(String(command))) {
    file = process.env.ComSpec || "cmd.exe";
    finalArgs = ["/d", "/c", command, ...args];
  }

  return new Promise((resolve, reject) => {
    const child = spawn(file, finalArgs, {
      windowsHide: true,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: opts.cwd || undefined,
    });
    if (opts.track) installState.child = child;

    let stdout = "";
    let stderr = "";
    let carry = "";
    let settled = false;
    let lastLogged = "";

    const flushLogLine = (raw) => {
      if (!opts.liveLog) return;
      const t = String(raw || "")
        .replace(/\x1b\[[0-9;]*m/g, "")
        .replace(/[^\S\r\n]+/g, " ")
        .trim();
      if (!t) return;
      if (t === lastLogged) return;
      lastLogged = t;
      pushLog(t.length > 2000 ? `${t.slice(0, 2000)}…` : t);
    };

    const timeout = setTimeout(() => {
      try {
        if (process.platform === "win32" && child.pid) {
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        } else {
          child.kill();
        }
      } catch {
        /* ignore */
      }
      if (!settled) {
        settled = true;
        if (opts.track) installState.child = null;
        reject(new Error(`Таймаут команды (${Math.round((opts.timeout || 1000 * 60 * 8) / 1000)}с)`));
      }
    }, opts.timeout || 1000 * 60 * 8);

    const onChunk = (buf, isErr) => {
      const text = buf.toString("utf8");
      if (isErr) stderr += text;
      else stdout += text;
      if (!opts.liveLog) return;
      const mixed = carry + text;
      const parts = mixed.split(/\r\n|\n|\r/);
      carry = parts.pop() || "";
      for (const line of parts) flushLogLine(line);
    };

    child.stdout.on("data", (d) => onChunk(d, false));
    child.stderr.on("data", (d) => onChunk(d, true));

    child.on("error", (err) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      if (opts.track) installState.child = null;
      reject(err);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      if (opts.track) installState.child = null;
      if (carry) flushLogLine(carry);
      if (installState.cancelRequested) {
        reject(new Error("Установка остановлена"));
        return;
      }
      const out = `${stdout || ""}${stderr || ""}`.trim();
      if (code && code !== 0) {
        const err = new Error(out.slice(0, 400) || `Команда завершилась с кодом ${code}${signal ? ` (${signal})` : ""}`);
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve(out);
    });
  });
}

function requestStopInstall() {
  installState.cancelRequested = true;
  const child = installState.child;
  if (child && child.pid) {
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      /* ignore */
    }
    pushLog("Остановка установки…");
    return { ok: true, stopped: true, message: "Останавливаю…" };
  }
  // Шаг без child (например ожидание OmniRoute) — флаг cancel уже выставлен
  pushLog("Остановка: прерываю текущий шаг…");
  return { ok: true, stopped: true, message: "Останавливаю ожидание…" };
}

function pushLog(line) {
  installState.log.push(`[${new Date().toLocaleTimeString()}] ${line}`);
  if (installState.log.length > 800) installState.log.shift();
}

function assertNotCancelled() {
  if (installState.cancelRequested) throw new Error("Установка остановлена");
}

async function getSetupStatus() {
  invalidateToolCache();
  const nodeBin = resolveNode();
  const npmBin = resolveNpm();
  let nodeVersion = null;
  if (nodeBin) {
    try {
      nodeVersion = (await runCmd(nodeBin, ["-v"])).trim();
    } catch {
      nodeVersion = null;
    }
  }

  const omniPath = path.join(NPM_BIN, "omniroute.cmd");
  const claudePath = path.join(NPM_BIN, "claude.cmd");
  const token = readToken();
  const omniRunning = await isOmniUp();
  const claudeOk = isClaudeCodeReady();

  const checks = {
    node: {
      ok: Boolean(nodeVersion),
      detail: nodeVersion ? `${nodeVersion}${nodeBin ? ` · ${nodeBin}` : ""}` : "не найден",
    },
    npm: { ok: Boolean(npmBin), detail: npmBin || "не найден" },
    omniroute: { ok: whichExists(omniPath), detail: whichExists(omniPath) ? "установлен" : "не установлен" },
    claude: {
      ok: claudeOk,
      detail: claudeOk
        ? "установлен"
        : whichExists(claudePath)
          ? "битый stub — нужен win32 binary"
          : "не установлен",
    },
    omniRunning: { ok: omniRunning, detail: omniRunning ? "online" : "offline" },
    token: { ok: Boolean(token), detail: token ? maskToken(token) : "не задан", masked: maskToken(token) },
  };

  const ready = checks.node.ok && checks.npm.ok && checks.omniroute.ok && checks.claude.ok && checks.token.ok;
  return { checks, ready, activeModel: readActiveModel(), install: { ...installState, child: undefined, log: installState.log.slice() } };
}

async function installAll() {
  if (installState.running) return;
  installState.running = true;
  installState.ok = null;
  installState.log = [];
  installState.finishedAt = null;
  installState.cancelRequested = false;
  installState.child = null;

  try {
    invalidateToolCache();
    installState.step = "node";
    assertNotCancelled();
    let nodeBin = resolveNode();
    let npmBin = resolveNpm();
    if (!nodeBin) {
      pushLog("Устанавливаю Node.js через winget…");
      if (!whichExists(WINGET)) throw new Error("winget не найден. Установи Node.js вручную с nodejs.org");
      await runCmd(WINGET, ["install", "-e", "--id", "OpenJS.NodeJS.LTS", "--accept-package-agreements", "--accept-source-agreements"], {
        timeout: 1000 * 60 * 15,
        liveLog: true,
        track: true,
      });
      invalidateToolCache();
      _winPathCache = null;
      nodeBin = resolveNode();
      npmBin = resolveNpm();
      pushLog("Node.js установлен");
    } else {
      pushLog(`Node.js уже есть: ${(await runCmd(nodeBin, ["-v"])).trim()} (${nodeBin})`);
    }

    assertNotCancelled();
    if (!npmBin) {
      invalidateToolCache();
      npmBin = resolveNpm();
    }
    if (!npmBin) throw new Error("npm.cmd не найден. Перезапусти FreeClaude или добавь Node в PATH.");

    const omniPath = path.join(NPM_BIN, "omniroute.cmd");
    const claudePath = path.join(NPM_BIN, "claude.cmd");

    installState.step = "omniroute";
    if (!whichExists(omniPath)) {
      pushLog("Устанавливаю OmniRoute (npm i -g omniroute)…");
      await runCmd(
        npmBin,
        ["install", "-g", "omniroute", "--no-fund", "--no-audit", "--loglevel", "verbose"],
        {
          timeout: 1000 * 60 * 12,
          liveLog: true,
          track: true,
          env: {
            npm_config_progress: "true",
            npm_config_loglevel: "verbose",
            npm_config_fetch_retries: "3",
          },
        }
      );
      assertNotCancelled();
      pushLog("OmniRoute установлен");
    } else {
      pushLog("OmniRoute уже установлен — пропускаю");
    }

    installState.step = "claude";
    if (!isClaudeCodeReady()) {
      if (whichExists(claudePath)) {
        pushLog("Claude Code есть, но без win32-бинарника (заглушка) — переустанавливаю с optional deps…");
      } else {
        pushLog("Устанавливаю Claude Code (npm i -g @anthropic-ai/claude-code)…");
      }
      await runCmd(
        npmBin,
        [
          "install",
          "-g",
          "@anthropic-ai/claude-code",
          "--include=optional",
          "--no-fund",
          "--no-audit",
          "--loglevel",
          "verbose",
        ],
        {
          timeout: 1000 * 60 * 12,
          liveLog: true,
          track: true,
          env: {
            npm_config_progress: "true",
            npm_config_loglevel: "verbose",
            npm_config_omit: "",
            npm_config_optional: "true",
          },
        }
      );
      assertNotCancelled();
      if (!isClaudeCodeReady()) {
        const installJs = path.join(NPM_BIN, "node_modules", "@anthropic-ai", "claude-code", "install.cjs");
        if (whichExists(installJs)) {
          pushLog("Запускаю postinstall Claude Code вручную…");
          await runCmd(nodeBin || resolveNode(), [installJs], {
            timeout: 1000 * 60 * 5,
            liveLog: true,
            track: true,
            cwd: path.dirname(installJs),
          });
        }
      }
      if (!isClaudeCodeReady()) {
        throw new Error(
          "Claude Code установился без нативного claude.exe. Проверь npm optional deps / интернет и повтори."
        );
      }
      pushLog("Claude Code установлен (win32 binary OK)");
    } else {
      pushLog("Claude Code уже установлен — пропускаю");
    }

    installState.step = "omni-start";
    pushLog("Запускаю OmniRoute…");
    const up = await ensureOmni(180000, { liveLog: true, checkCancel: true });
    assertNotCancelled();
    pushLog(up ? "OmniRoute online" : "OmniRoute пока offline — открой его вручную командой omniroute");

    installState.step = "done";
    installState.ok = true;
    pushLog("Готово. Добавь API-ключ OmniRoute (если ещё нет) и пользуйся.");
  } catch (err) {
    installState.ok = false;
    installState.step = installState.cancelRequested ? "stopped" : "error";
    pushLog(`${installState.cancelRequested ? "Остановлено" : "Ошибка"}: ${err.message || err}`);
  } finally {
    installState.running = false;
    installState.child = null;
    installState.finishedAt = Date.now();
  }
}

async function omniFetch(pathname, options = {}) {
  const token = readToken();
  const res = await fetch(`${OMNI}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { ok: res.ok, status: res.status, text, json };
}

function send(res, status, data, type = "application/json") {
  let body;
  if (Buffer.isBuffer(data)) body = data;
  else if (typeof data === "string") body = data;
  else body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function mime(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "application/javascript; charset=utf-8";
  return "application/octet-stream";
}

function findBrowser() {
  const candidates = [
    path.join(process.env.ProgramFiles || "", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env.ProgramFiles || "", "Microsoft\\Edge\\Application\\msedge.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft\\Edge\\Application\\msedge.exe"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function shouldOpenBrowser() {
  if (process.env.FREECLAUDE_NO_BROWSER === "1") return false;
  return true;
}

function openWindow() {
  if (!shouldOpenBrowser()) return;
  const url = `http://127.0.0.1:${PORT}`;
  const sys = process.env.SystemRoot || "C:\\Windows";
  const logPath = path.join(DATA_DIR, "open-ui.log");
  const log = (msg) => {
    try {
      fs.appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`);
    } catch {
      /* ignore */
    }
  };

  const attempts = [
    {
      name: "rundll32",
      run: () =>
        execFileSync(path.join(sys, "System32", "rundll32.exe"), ["url.dll,FileProtocolHandler", url], {
          stdio: "ignore",
          windowsHide: true,
          timeout: 8000,
        }),
    },
    {
      name: "powershell",
      run: () =>
        execFileSync(
          path.join(sys, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
          ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", `Start-Process '${url}'`],
          { stdio: "ignore", windowsHide: true, timeout: 15000 }
        ),
    },
    {
      name: "explorer",
      run: () =>
        execFileSync(path.join(sys, "explorer.exe"), [url], {
          stdio: "ignore",
          windowsHide: true,
          timeout: 8000,
        }),
    },
  ];

  for (const step of attempts) {
    try {
      step.run();
      log(`ok ${step.name} pkg=${IS_PKG}`);
      return;
    } catch (err) {
      log(`fail ${step.name}: ${err && err.message ? err.message : err}`);
    }
  }
  log("all open methods failed");
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://127.0.0.1:${PORT}`);

    if (req.method === "GET" && u.pathname === "/api/access") {
      const force = u.searchParams.get("force") === "1";
      return send(res, 200, await checkAccess(force));
    }

    // Gate mutating/app APIs when remote flag is 0 (static files + /api/access stay available)
    const gated =
      u.pathname.startsWith("/api/") &&
      u.pathname !== "/api/access" &&
      u.pathname !== "/api/status";
    if (gated) {
      const access = await checkAccess(false);
      if (!access.allowed) {
        return send(res, 403, accessDeniedPayload());
      }
    }

    if (req.method === "GET" && u.pathname === "/api/setup") {
      return send(res, 200, await getSetupStatus());
    }

    if (req.method === "POST" && u.pathname === "/api/setup/install") {
      if (!installState.running) installAll();
      return send(res, 200, { ok: true, started: true, install: { ...installState, child: undefined } });
    }

    if (req.method === "POST" && u.pathname === "/api/setup/install/stop") {
      const result = requestStopInstall();
      return send(res, 200, result);
    }

    if (req.method === "POST" && u.pathname === "/api/key") {
      const { apiKey } = await readBody(req);
      const key = String(apiKey || "").trim();
      if (!key) return send(res, 400, { ok: false, error: "Пустой ключ" });
      const model = readActiveModel() || "kiro/claude-sonnet-4.5";
      writeSettings(model, key);
      return send(res, 200, { ok: true, masked: maskToken(key), activeModel: model });
    }

    if (req.method === "POST" && u.pathname === "/api/key/generate") {
      try {
        const account = omniKeys.getAccountLimitInfo();
        if (!account.connected) {
          return send(res, 400, {
            ok: false,
            error: "Сначала войди в Kiro — без аккаунта ключ бесполезен",
          });
        }
        // Всегда новый ключ (кнопка «Получить ключ» / смена аккаунта Kiro)
        const created = omniKeys.createApiKey(
          `freeclaude-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}`
        );
        const model = readActiveModel() || "kiro/claude-sonnet-4.5";
        writeSettings(model, created.key);
        return send(res, 200, {
          ok: true,
          key: created.key,
          masked: created.masked,
          id: created.id,
          createdAt: created.createdAt,
          reused: false,
          note: "Новый ключ OmniRoute создан. Лимиты идут от текущего аккаунта Kiro.",
        });
      } catch (err) {
        return send(res, 500, { ok: false, error: String(err.message || err) });
      }
    }

    if (req.method === "GET" && u.pathname === "/api/keys") {
      try {
        const keys = omniKeys.listApiKeys().map(({ key, ...rest }) => rest);
        return send(res, 200, { keys, activeMasked: maskToken(readToken()) });
      } catch (err) {
        return send(res, 500, { error: String(err.message || err) });
      }
    }

    if (req.method === "GET" && u.pathname === "/api/quota") {
      try {
        const token = readToken();
        const usage = token
          ? omniKeys.getKeyUsage(token)
          : { found: false, masked: "", usedTokens: 0, remaining: null, unlimited: true, requests: 0, todayTokens: 0 };
        let soonest = 0;
        try {
          const h = await fetch(`${OMNI}/api/monitoring/health`, { signal: AbortSignal.timeout(2500) });
          if (h.ok) {
            const health = await h.json();
            soonest = health?.connectionHealth?.kiro?.soonestRetryAfterMs || 0;
          }
        } catch {
          /* ignore */
        }
        const account = omniKeys.getAccountLimitInfo();
        // soonestRetryAfterMs у OmniRoute бывает от старых Kiro-сессий —
        // применяем только если активный аккаунт реально в лимите
        if (soonest > 0 && account.limited) {
          const soonestAt = Date.now() + soonest;
          if (!account.resetAt || soonestAt > account.resetAt) {
            account.resetAt = soonestAt;
            account.resetInMs = soonest;
            account.resetInText = omniKeys.formatDuration(soonest);
          }
        } else if (account.resetInMs > 0 && !account.resetAt) {
          account.resetAt = Date.now() + account.resetInMs;
        }
        return send(res, 200, {
          activeKey: usage.masked || maskToken(token),
          usage,
          account,
          serverNow: Date.now(),
        });
      } catch (err) {
        return send(res, 500, { error: String(err.message || err) });
      }
    }

    if (req.method === "POST" && u.pathname === "/api/kiro/open") {
      // Legacy: start flow, client should open AWS itself; keep URL in response.
      try {
        const flow = await startKiroBuilderIdFlow();
        return send(res, 200, { ok: true, ...flow, opened: false });
      } catch (err) {
        return send(res, 500, { ok: false, error: String(err.message || err) });
      }
    }

    if (req.method === "POST" && u.pathname === "/api/kiro/start") {
      try {
        const body = await readBody(req);
        const flow = await startKiroBuilderIdFlow();
        // Only spawn a separate Chrome --app if client explicitly asks (legacy).
        const openAuth = body.open === true;
        if (openAuth) openUrlApp(flow.verificationUriComplete);
        return send(res, 200, { ok: true, ...flow, opened: openAuth });
      } catch (err) {
        return send(res, 500, { ok: false, error: String(err.message || err) });
      }
    }

    if (req.method === "POST" && u.pathname === "/api/kiro/poll") {
      try {
        const result = await pollKiroBuilderIdOnce();
        let extras = {
          keyIssued: null,
          ready: false,
          kiroConnected: false,
          modelsCount: 0,
        };
        if (result.success) {
          try {
            extras = await finalizeKiroAuth();
          } catch (err) {
            extras.keyIssued = { error: String(err.message || err) };
          }
        }
        return send(res, 200, { ok: true, ...result, ...extras });
      } catch (err) {
        return send(res, 500, { ok: false, success: false, pending: false, error: String(err.message || err) });
      }
    }

    if (req.method === "POST" && u.pathname === "/api/kiro/cancel") {
      clearKiroOAuthSession();
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && u.pathname === "/api/kiro/open-aws") {
      const body = await readBody(req).catch(() => ({}));
      if (!kiroOAuth.verificationUriComplete && !body.url) {
        return send(res, 400, { ok: false, error: "Нет активного кода — сначала «Войти в Kiro»" });
      }
      const url = body.url || kiroOAuth.verificationUriComplete;
      const fresh = body.fresh !== false;
      const opened = openAwsAuthWindow(url, { fresh });
      return send(res, 200, {
        ok: true,
        userCode: kiroOAuth.userCode,
        verificationUriComplete: url,
        ...opened,
      });
    }

    if (req.method === "POST" && u.pathname === "/api/kiro/aws-signout") {
      // Выход из AWS Access Portal в чистом окне (сессия Builder ID)
      omniKeys.logoutKiro(null);
      const opened = openAwsSignOut();
      return send(res, 200, {
        ok: true,
        message: "Открыт выход из AWS. Потом снова нажми «Войти в Kiro».",
        telegram: TELEGRAM_URL,
        ...opened,
      });
    }

    if (req.method === "POST" && u.pathname === "/api/kiro/logout") {
      try {
        const body = await readBody(req);
        const result = omniKeys.logoutKiro(body.id || null);
        return send(res, 200, { ok: true, ...result });
      } catch (err) {
        return send(res, 500, { ok: false, error: String(err.message || err) });
      }
    }

    if (req.method === "GET" && u.pathname === "/api/status") {
      const omni = await isOmniUp();
      let kiro = false;
      try {
        if (omni) {
          try {
            omniKeys.healKiroConnections();
          } catch {
            /* ignore */
          }
          const lim = omniKeys.getAccountLimitInfo();
          kiro = Boolean(lim && lim.connected);
          if (!kiro) {
            try {
              kiro = Boolean(omniKeys.hasKiroCredentials());
            } catch {
              /* ignore */
            }
          }
        }
      } catch {
        kiro = false;
      }
      return send(res, 200, {
        omni,
        token: Boolean(readToken()),
        tokenMasked: maskToken(readToken()),
        activeModel: readActiveModel(),
        kiro,
      });
    }

    if (req.method === "POST" && u.pathname === "/api/bootstrap") {
      const status = await getSetupStatus();
      if (!status.checks.omniroute.ok) {
        return send(res, 200, { ok: false, omni: false, needSetup: true, activeModel: readActiveModel(), token: status.checks.token.ok });
      }
      const ok = await ensureOmni();
      return send(res, 200, { ok, omni: ok, activeModel: readActiveModel(), token: Boolean(readToken()) });
    }

    if (req.method === "GET" && u.pathname === "/api/models") {
      if (!(await isOmniUp())) return send(res, 503, { error: "OmniRoute offline" });
      const r = await omniFetch("/v1/models");
      if (!r.ok) return send(res, r.status, { error: r.text || "OmniRoute unavailable" });
      const all = r.json?.data || [];
      const models = all
        .filter(
          (m) =>
            /^(kiro|kr)\//i.test(m.id) &&
            !/-low$|-medium$|-high$|-xhigh$/i.test(m.id) &&
            !m.id.includes("no-think")
        )
        .map((m) => ({
          id: m.id,
          name: (m.name || m.id).replace(/^kiro\//i, "").replace(/^kr\//i, ""),
          owned_by: m.owned_by || "kiro",
          context_length: m.context_length || null,
        }));

      const byBase = new Map();
      for (const m of models) {
        const base = m.id.replace(/^(kiro|kr)\//, "");
        const prev = byBase.get(base);
        if (!prev || m.id.startsWith("kiro/")) byBase.set(base, m);
      }
      const deduped = [...byBase.values()].sort((a, b) => a.id.localeCompare(b.id));
      return send(res, 200, { models: deduped, activeModel: readActiveModel() });
    }

    if (req.method === "POST" && u.pathname === "/api/test") {
      const { model } = await readBody(req);
      if (!model) return send(res, 400, { ok: false, error: "model required" });
      const started = Date.now();
      const r = await omniFetch("/v1/messages", {
        method: "POST",
        body: JSON.stringify({
          model,
          max_tokens: 16,
          messages: [{ role: "user", content: "Reply with OK" }],
        }),
      });
      const ms = Date.now() - started;
      if (!r.ok) {
        const err =
          r.json?.error?.message ||
          r.json?.message ||
          (typeof r.json?.error === "string" ? r.json.error : null) ||
          r.text.slice(0, 220);
        return send(res, 200, { ok: false, status: r.status, error: String(err), ms });
      }
      return send(res, 200, { ok: true, status: r.status, reply: r.json?.content?.[0]?.text || "", ms });
    }

    if (req.method === "POST" && u.pathname === "/api/connect") {
      const { model } = await readBody(req);
      if (!model) return send(res, 400, { ok: false, error: "model required" });
      const token = readToken();
      if (!token) return send(res, 400, { ok: false, error: "Сначала сохрани API-ключ OmniRoute в блоке Настройка" });
      writeSettings(model, token);
      return send(res, 200, { ok: true, model, activeModel: model });
    }

    if (req.method === "POST" && u.pathname === "/api/launch") {
      const token = readToken();
      const model = readActiveModel() || "kiro/claude-sonnet-4.5";
      if (!token) return send(res, 400, { ok: false, error: "Нет API-ключа" });
      if (!(await isOmniUp())) {
        const up = await ensureOmni(60000);
        if (!up) return send(res, 503, { ok: false, error: "OmniRoute не запустился" });
      }
      writeSettings(model, token);

      const launcher = path.join(DATA_DIR, "launch-claude.cmd");
      fs.writeFileSync(
        launcher,
        `@echo off
setlocal EnableExtensions
set "PATH=${nodeDir().replace(/\\/g, "\\\\")};%APPDATA%\\npm;%PATH%"
title Claude Code - ${model}
echo.
echo  Model: ${model}
echo  Starting Claude Code...
echo.
call "${FREECLAUDE}"
if errorlevel 1 pause
`
      );

      spawn("cmd.exe", ["/c", "start", "Claude Code", "cmd.exe", "/k", launcher], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
        cwd: DATA_DIR,
        env: { ...process.env, PATH: `${nodeDir()};${NPM_BIN};${enrichedPath()}` },
      }).unref();

      return send(res, 200, { ok: true, model });
    }

    const safeName = u.pathname === "/" ? "index.html" : path.normalize(u.pathname).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
    // Packaged: ONLY serve on-disk ./public next to exe (never embedded snapshot CSS/HTML/JS).
    // Snapshot fallback caused F5 to flip between old/new styles when roots mixed.
    const diskPublicRoot = path.join(EXE_DIR, "public");
    const snapPublicRoot = PUBLIC;
    const root =
      IS_PKG && fs.existsSync(path.join(diskPublicRoot, "index.html"))
        ? diskPublicRoot
        : snapPublicRoot;
    const filePath = path.join(root, safeName);
    const rel = path.relative(root, filePath);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return send(res, 403, "Forbidden", "text/plain");
    if (!fs.existsSync(filePath)) return send(res, 404, "Not found", "text/plain");
    let body = fs.readFileSync(filePath);
    const type = mime(filePath);
    // Inline CSS into HTML so a refresh can never paint without styles (no 2nd-request race).
    if (safeName === "index.html" || safeName.replace(/\\/g, "/") === "index.html") {
      try {
        let html = body.toString("utf8");
        const cssPath = path.join(root, "styles.css");
        if (fs.existsSync(cssPath)) {
          const css = fs.readFileSync(cssPath, "utf8");
          if (/id=["']fc-css["']/.test(html)) {
            html = html.replace(
              /<style id=["']fc-css["']>[\s\S]*?<\/style>/i,
              `<style id="fc-css">\n${css}\n</style>`
            );
          } else {
            html = html.replace(
              /<link[^>]*href=["']\/styles\.css[^"']*["'][^>]*>/i,
              `<style id="fc-css">\n${css}\n</style>`
            );
          }
        }
        // Bust JS cache every serve (mtime) — avoids stale app.js after updates
        try {
          const jsPath = path.join(root, "app.js");
          const ver = fs.existsSync(jsPath) ? String(fs.statSync(jsPath).mtimeMs | 0) : String(Date.now());
          html = html.replace(/\/app\.js\?v=[^"']+/i, `/app.js?v=${ver}`);
          if (!/\/app\.js\?v=/.test(html)) {
            html = html.replace(/\/app\.js(["'])/i, `/app.js?v=${ver}$1`);
          }
        } catch {
          /* ignore */
        }
        html = html
          .replace(/<link[^>]+fonts\.googleapis\.com[^>]*>\s*/gi, "")
          .replace(/<link[^>]+fonts\.gstatic\.com[^>]*>\s*/gi, "");
        body = Buffer.from(html, "utf8");
      } catch {
        /* serve raw html */
      }
    }
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store, max-age=0, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      "X-FC-Public": root === diskPublicRoot ? "disk" : "snap",
    });
    return res.end(body);
  } catch (err) {
    return send(res, 500, { error: String(err.message || err) });
  }
});

async function main() {
  // Seed config from existing settings for current test key (do not wipe)
  if (!readConfig().apiKey) {
    const existing = readToken();
    if (existing) writeConfig({ apiKey: existing, model: readActiveModel() || "kiro/claude-sonnet-4.5" });
  }

  // Already running → just open browser (no bat/cmd chain).
  try {
    const probe = await fetch(`http://127.0.0.1:${PORT}/api/status`, { signal: AbortSignal.timeout(800) });
    if (probe.ok) {
      console.log("GUI already running:", `http://127.0.0.1:${PORT}`);
      openWindow();
      if (IS_PKG) process.exit(0);
      return;
    }
  } catch {
    /* start fresh */
  }

  server.listen(PORT, "127.0.0.1", async () => {
    installOmniShutdownHooks();
    const diskPublicRoot = path.join(EXE_DIR, "public");
    const uiRoot =
      IS_PKG && fs.existsSync(path.join(diskPublicRoot, "index.html")) ? diskPublicRoot : PUBLIC;
    console.log(`FreeClaude GUI: http://127.0.0.1:${PORT}`);
    console.log(`UI assets: ${IS_PKG ? (uiRoot === diskPublicRoot ? "disk" : "snapshot") : "dev"} → ${uiRoot}`);
    console.log("Одна консоль: OmniRoute стартует в фоне, отдельное окно не нужно.");

    openWindow();

    try {
      if (
        whichExists(path.join(NPM_BIN, "omniroute.cmd")) ||
        whichExists(path.join(NPM_BIN, "node_modules", "omniroute", "bin", "omniroute.mjs"))
      ) {
        const ok = await ensureOmni();
        if (ok) {
          console.log("OmniRoute online");
          console.log("Закроете это окно FreeClaude — OmniRoute тоже остановится.");
        } else {
          console.log("OmniRoute offline — открой Настройки → Установить недостающее");
        }
      } else {
        console.log("OmniRoute not installed — open Setup in GUI");
      }
    } catch (err) {
      console.error("OmniRoute bootstrap error:", err && err.message ? err.message : err);
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
