const state = {
  models: [],
  results: JSON.parse(localStorage.getItem("fc-results-v2") || "{}"),
  activeModel: "",
  query: "",
  testing: new Set(),
  omniOnline: false,
  kiroConnected: false,
  limit: {
    limited: false,
    banned: false,
    resetAt: null,
    hint: "",
  },
  limitTimer: null,
  quotaPoll: null,
  setupPoll: null,
  tab: "home",
};

const els = {
  grid: document.getElementById("grid"),
  search: document.getElementById("search"),
  connSub: document.getElementById("connSub"),
  connSubText: document.getElementById("connSubText"),
  connDot: document.getElementById("connDot"),
  connMeta: document.getElementById("connMeta"),
  modelTag: document.getElementById("modelTag"),
  foot: document.getElementById("foot"),
  sideStatus: document.getElementById("sideStatus"),
  sideStatusText: document.getElementById("sideStatusText"),
  btnLaunch: document.getElementById("btnLaunch"),
  btnLaunchBar: document.getElementById("btnLaunchBar"),
  activeBar: document.getElementById("activeBar"),
  activeBarIcon: document.getElementById("activeBarIcon"),
  activeBarModel: document.getElementById("activeBarModel"),
  toast: document.getElementById("toast"),
  checkGrid: document.getElementById("checkGrid"),
  apiKey: document.getElementById("apiKey"),
  keyCurrent: document.getElementById("keyCurrent"),
  usageUsed: document.getElementById("usageUsed"),
  usageLeft: document.getElementById("usageLeft"),
  usageReq: document.getElementById("usageReq"),
  usageToday: document.getElementById("usageToday"),
  accountState: document.getElementById("accountState"),
  accountMeta: document.getElementById("accountMeta"),
  installLogWrap: document.getElementById("installLogWrap"),
  installLog: document.getElementById("installLog"),
  btnInstallAll: document.getElementById("btnInstallAll"),
  btnStopInstall: document.getElementById("btnStopInstall"),
  btnGenKey: document.getElementById("btnGenKey"),
  btnOpenKiro: document.getElementById("btnOpenKiro"),
  btnAwsSignOut: document.getElementById("btnAwsSignOut"),
  limitBanner: document.getElementById("limitBanner"),
  limitBannerTitle: document.getElementById("limitBannerTitle"),
  limitTimer: document.getElementById("limitTimer"),
  limitBannerHint: document.getElementById("limitBannerHint"),
  btnLimitSwitch: document.getElementById("btnLimitSwitch"),
  kiroModal: document.getElementById("kiroModal"),
  kiroUserCode: document.getElementById("kiroUserCode"),
  kiroStatus: document.getElementById("kiroStatus"),
  kiroWait: document.getElementById("kiroWait"),
  kiroWaitTitle: document.getElementById("kiroWaitTitle"),
  kiroWaitSub: document.getElementById("kiroWaitSub"),
  btnKiroOpenAws: document.getElementById("btnKiroOpenAws"),
  btnKiroRetry: document.getElementById("btnKiroRetry"),
};

let toastTimer = null;

function save() {
  localStorage.setItem("fc-results-v2", JSON.stringify(state.results));
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toast(msg, isErr = false) {
  els.toast.textContent = msg;
  els.toast.classList.toggle("err", isErr);
  els.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 3500);
}

function setTab(tab) {
  const allowed = new Set(["home", "models", "setup"]);
  state.tab = allowed.has(tab) ? tab : "home";
  try {
    localStorage.setItem("fc-tab", state.tab);
  } catch {
    /* ignore */
  }
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
  const home = document.getElementById("tab-home");
  const models = document.getElementById("tab-models");
  const setup = document.getElementById("tab-setup");
  if (home) home.classList.toggle("hidden", state.tab !== "home");
  if (models) models.classList.toggle("hidden", state.tab !== "models");
  if (setup) setup.classList.toggle("hidden", state.tab !== "setup");
  if (els.foot) els.foot.classList.toggle("hidden", state.tab !== "models");
  if (state.tab === "setup") {
    loadSetup();
    loadQuota().catch(() => {});
  }
}

function statusOf(id) {
  if (state.testing.has(id)) return { cls: "busy", mark: "" };
  const r = state.results[id];
  if (!r) return { cls: "", mark: "?" };
  if (r.ok) return { cls: "ok", mark: "✓" };
  return { cls: "fail", mark: "!" };
}

function visible() {
  return state.models.filter((m) => {
    const q = state.query;
    if (q && !m.id.toLowerCase().includes(q) && !(m.name || "").toLowerCase().includes(q)) return false;
    return true;
  });
}

function modelIconSlug(id) {
  const s = String(id || "").toLowerCase().replace(/^(kiro|kr)\//, "");
  if (/claude|haiku|sonnet|opus/.test(s)) return "claude-color";
  if (/deepseek/.test(s)) return "deepseek-color";
  if (/glm|chatglm|zhipu/.test(s)) return "chatglm-color";
  if (/gpt|openai|luna|sol|terra/.test(s)) return "openai";
  if (/minimax/.test(s)) return "minimax-color";
  if (/qwen/.test(s)) return "qwen-color";
  return "kiro-color";
}

function modelIconHtml(id) {
  const slug = modelIconSlug(id);
  const src = `https://unpkg.com/@lobehub/icons-static-svg@latest/icons/${slug}.svg`;
  const fallback = "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/kiro-color.svg";
  return `<div class="icon" title="${esc(slug.replace(/-color$/, ""))}"><img src="${src}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${fallback}'" /></div>`;
}

function modelIconImgHtml(id) {
  const slug = modelIconSlug(id);
  const src = `https://unpkg.com/@lobehub/icons-static-svg@latest/icons/${slug}.svg`;
  const fallback = "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/kiro-color.svg";
  return `<img src="${src}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${fallback}'" />`;
}

function formatCountdown(ms) {
  const left = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function updateLimitTicker() {
  const lim = state.limit;
  if (!lim.limited && !lim.banned) {
    if (els.limitBanner) els.limitBanner.classList.add("hidden");
    if (els.accountMeta && state.kiroConnected && !lim.banned) {
      /* account meta handled in renderQuota */
    }
    return;
  }

  if (els.limitBanner) els.limitBanner.classList.remove("hidden");
  if (els.limitBannerTitle) {
    els.limitBannerTitle.textContent = lim.banned ? "Аккаунт Kiro заблокирован" : "Лимит на аккаунте Kiro";
  }
  if (els.limitBannerHint) {
    els.limitBannerHint.textContent = lim.banned
      ? shortBanReason(lim.hint) + " — смените аккаунт"
      : "Поменяйте аккаунт или дождитесь снятия лимита";
  }

  let leftMs = 0;
  if (lim.resetAt) leftMs = Math.max(0, lim.resetAt - Date.now());
  const timerText = lim.banned
    ? "нужен другой аккаунт"
    : leftMs > 0
      ? `Снимется через ${formatCountdown(leftMs)}`
      : "Проверяю статус…";

  if (els.limitTimer) els.limitTimer.textContent = timerText;

  if (els.accountState && lim.limited && !lim.banned) {
    els.accountState.className = "al-state limited";
    els.accountState.textContent = leftMs > 0 ? `лимит · ${formatCountdown(leftMs)}` : "лимит";
    if (els.accountMeta) {
      els.accountMeta.textContent =
        leftMs > 0 ? `подожди ${formatCountdown(leftMs)} или смени аккаунт` : "подожди или смени аккаунт";
    }
  }

  if (!lim.banned && lim.resetAt && leftMs <= 0) {
    if (!state._quotaReloadAt || Date.now() - state._quotaReloadAt > 8000) {
      state._quotaReloadAt = Date.now();
      loadQuota().catch(() => {});
    }
  }
}

function ensureLimitTimer() {
  if (state.limitTimer) return;
  state.limitTimer = setInterval(updateLimitTicker, 1000);
}

function ensureQuotaPoll() {
  if (state.quotaPoll) return;
  state.quotaPoll = setInterval(() => {
    loadQuota().catch(() => {});
  }, 20000);
}

function applyAccountLimit(account, serverNow) {
  const a = account || {};
  let resetAt = a.resetAt || null;
  if (!resetAt && a.resetInMs > 0) {
    const skew = serverNow ? Date.now() - Number(serverNow) : 0;
    resetAt = Date.now() - skew + Number(a.resetInMs);
  }
  // Короткие cooldown (< 60с) не считаем «лимитом аккаунта» — иначе баннер мигает при работе.
  const MIN_UI_LIMIT_MS = 60 * 1000;
  const leftNow = resetAt ? Math.max(0, resetAt - Date.now()) : Number(a.resetInMs || 0);
  const seriousLimit = Boolean(a.limited) && leftNow >= MIN_UI_LIMIT_MS;
  state.limit = {
    limited: seriousLimit || Boolean(a.banned),
    banned: Boolean(a.banned),
    resetAt: seriousLimit ? resetAt : null,
    hint: a.banReason || a.resetInText || "",
  };
  ensureLimitTimer();
  ensureQuotaPoll();
  updateLimitTicker();
  updateLaunchButtons();
  render();
}

function updateLaunchButtons() {
  const hasSession = Boolean(state.omniOnline && state.kiroConnected && !state.limit?.banned);
  const limited = Boolean(state.limit?.limited) && !state.limit?.banned;
  const ready = Boolean(state.activeModel) && hasSession && !limited;
  els.btnLaunch.disabled = !ready;
  if (els.btnLaunchBar) els.btnLaunchBar.disabled = !ready;

  // Активную модель показываем только при живой сессии (OmniRoute + Kiro)
  if (state.activeModel && hasSession) {
    els.activeBar.classList.remove("hidden");
    els.activeBarModel.textContent = state.activeModel;
    if (els.activeBarIcon) {
      els.activeBarIcon.title = modelIconSlug(state.activeModel).replace(/-color$/, "");
      els.activeBarIcon.innerHTML = modelIconImgHtml(state.activeModel);
    }
    els.modelTag.textContent = state.activeModel;
    els.modelTag.classList.remove("soft");
  } else {
    els.activeBar.classList.add("hidden");
    if (els.activeBarIcon) {
      els.activeBarIcon.innerHTML = "";
      els.activeBarIcon.removeAttribute("title");
    }
    if (!state.omniOnline) {
      els.modelTag.textContent = "OmniRoute offline";
    } else if (!state.kiroConnected) {
      els.modelTag.textContent = "нет аккаунта Kiro";
    } else if (state.limit?.banned) {
      els.modelTag.textContent = "аккаунт заблокирован";
    } else {
      els.modelTag.textContent = "не выбрана";
    }
    els.modelTag.classList.add("soft");
  }
}

function updateAuthButtons(connected, opts = {}) {
  const banned = Boolean(opts.banned);
  state.kiroConnected = Boolean(connected) && !banned;
  if (els.btnOpenKiro) {
    els.btnOpenKiro.classList.toggle("hidden", state.kiroConnected && !banned);
    els.btnOpenKiro.disabled = false;
    els.btnOpenKiro.textContent = banned ? "Сменить аккаунт" : "Войти в Kiro";
  }
  if (els.btnAwsSignOut) {
    // Только когда есть сессия Kiro / бан — иначе кнопка выхода не нужна
    els.btnAwsSignOut.classList.toggle("hidden", !state.kiroConnected && !banned);
    els.btnAwsSignOut.disabled = false;
  }
  if (els.btnGenKey) {
    els.btnGenKey.disabled = !state.kiroConnected;
    els.btnGenKey.title = state.kiroConnected
      ? "Создать локальный ключ OmniRoute"
      : banned
        ? "Аккаунт Kiro заблокирован"
        : "Сначала войди в Kiro";
  }
  if (state.models.length) render();
  else updateLaunchButtons();
}

function shortBanReason(text) {
  const s = String(text || "");
  if (/suspend|banned|locked/i.test(s)) return "Kiro временно заблокировал аккаунт";
  return (s.slice(0, 120) || "аккаунт недоступен");
}

function setStatusIcon(el, mode) {
  if (!el) return;
  const ico = el.querySelector(".status-ico") || el;
  if (!ico.classList.contains("status-ico") && ico !== el) return;
  const target = el.querySelector(".status-ico") || (el.classList.contains("status-ico") ? el : null);
  if (!target) return;
  target.classList.remove("on", "off", "pending");
  target.classList.add(mode === true || mode === "on" ? "on" : mode === false || mode === "off" ? "off" : "pending");
}

function renderConn(status) {
  const online = Boolean(status?.omni);
  state.omniOnline = online;
  els.connDot.className = `dot ${online ? "on" : "off"}`;
  const text = online ? "OmniRoute online" : "OmniRoute offline";
  if (els.connSubText) els.connSubText.textContent = text;
  else els.connSub.textContent = text;
  setStatusIcon(els.connSub, online);
  els.connMeta.textContent = online
    ? `ключ ${status.token ? status.tokenMasked || "есть" : "нет"}`
    : "localhost:20128 недоступен";
  if (els.sideStatusText) els.sideStatusText.textContent = online ? "online" : "offline";
  else els.sideStatus.textContent = online ? "online" : "offline";
  setStatusIcon(els.sideStatus, online);
  if (status?.activeModel) state.activeModel = status.activeModel;
  if (state.models.length) render();
  else updateLaunchButtons();
}

function renderSetup(setup) {
  const labels = {
    node: "Node.js",
    npm: "npm",
    omniroute: "OmniRoute",
    claude: "Claude Code",
    omniRunning: "Сервер",
    token: "API-ключ",
  };
  const order = ["node", "npm", "omniroute", "claude", "omniRunning", "token"];
  els.checkGrid.innerHTML = order
    .map((key) => {
      const item = setup.checks[key];
      return `<div class="check-item ${item.ok ? "ok" : "bad"}">
        <div class="label">${labels[key]}</div>
        <div class="value"><span class="mark">${item.ok ? "✓" : "!"}</span>${item.ok ? "OK" : "Нет"}</div>
        <div class="detail">${esc(item.detail)}</div>
      </div>`;
    })
    .join("");

  if (setup.checks.token.masked) {
    if (els.keyCurrent) els.keyCurrent.textContent = setup.checks.token.masked;
    if (!els.apiKey.value) els.apiKey.placeholder = setup.checks.token.masked;
  } else if (els.keyCurrent) {
    els.keyCurrent.textContent = "нет ключа";
  }

  const inst = setup.install || {};
  if (inst.running || (inst.log && inst.log.length)) {
    els.installLogWrap.classList.remove("hidden");
    const text = (inst.log || []).join("\n");
    if (els.installLog.textContent !== text) {
      const nearBottom =
        els.installLog.scrollHeight - els.installLog.scrollTop - els.installLog.clientHeight < 80;
      els.installLog.textContent = text;
      if (nearBottom || inst.running) els.installLog.scrollTop = els.installLog.scrollHeight;
    }
  }
  els.btnInstallAll.disabled = Boolean(inst.running);
  els.btnInstallAll.textContent = inst.running
    ? `Установка…${inst.step ? ` (${inst.step})` : ""}`
    : "Установить недостающее";
  if (els.btnStopInstall) {
    els.btnStopInstall.classList.toggle("hidden", !inst.running);
    els.btnStopInstall.disabled = !inst.running;
  }
}

function renderQuota(data) {
  const u = data.usage || {};
  if (els.keyCurrent) els.keyCurrent.textContent = data.activeKey || u.masked || "нет ключа";
  if (els.usageUsed) els.usageUsed.textContent = formatTokens(u.usedTokens);
  if (els.usageLeft) els.usageLeft.textContent = u.unlimited || u.remaining == null ? "∞" : formatTokens(u.remaining);
  if (els.usageReq) els.usageReq.textContent = String(u.requests ?? 0);
  if (els.usageToday) els.usageToday.textContent = formatTokens(u.todayTokens);

  const a = data.account || {};
  updateAuthButtons(Boolean(a.connected), { banned: Boolean(a.banned) });
  applyAccountLimit(a, data.serverNow);

  if (els.accountState && els.accountMeta) {
    if (a.banned) {
      els.accountState.className = "al-state limited";
      els.accountState.textContent = "заблокирован";
      els.accountMeta.textContent = shortBanReason(a.banReason);
    } else if (!a.connected) {
      els.accountState.className = "al-state off";
      els.accountState.textContent = "не подключён";
      els.accountMeta.textContent = "нажми «Войти в Kiro»";
    } else if (a.limited) {
      // live text updated by updateLimitTicker
      updateLimitTicker();
    } else {
      const k = (a.kiro || []).find((x) => x.state === "ok") || (a.kiro || [])[0];
      els.accountState.className = "al-state ok";
      els.accountState.textContent = "активен";
      els.accountMeta.textContent = k?.oauthLeftText ? `OAuth ещё ${k.oauthLeftText}` : "ok";
    }
  }
}

async function awsSignOut() {
  if (els.btnAwsSignOut) els.btnAwsSignOut.disabled = true;
  try {
    const r = await fetch("/api/kiro/aws-signout", { method: "POST" }).then((x) => x.json());
    if (!r.ok) {
      toast(r.error || "Не удалось открыть выход AWS", true);
      return;
    }
    updateAuthButtons(false);
    toast("Открыт выход AWS. Закрой окно и снова войди в Kiro");
    await loadQuota().catch(() => {});
  } catch (e) {
    toast(String(e.message || e), true);
  } finally {
    if (els.btnAwsSignOut) els.btnAwsSignOut.disabled = false;
  }
}

async function openKiroAuth() {
  if (els.btnOpenKiro) els.btnOpenKiro.disabled = true;
  try {
    // Сброс старых Kiro-сессий OmniRoute перед новым входом
    await fetch("/api/kiro/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => {});

    const r = await fetch("/api/kiro/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ open: false }),
    }).then((x) => x.json());
    if (!r.ok) {
      toast(r.error || "Не удалось начать вход в Kiro", true);
      return;
    }

    kiroAuth.active = true;
    kiroAuth.intervalMs = Math.max(3000, (Number(r.interval) || 5) * 1000);
    kiroAuth.verificationUriComplete = r.verificationUriComplete || "";

    if (els.kiroUserCode) els.kiroUserCode.textContent = r.userCode || "—";
    setKiroStatus("Ждём подтверждение…");
    setKiroWait(
      "wait",
      "Ждём вход в AWS…",
      "Открыто чистое окно без старой сессии — войди нужным аккаунтом и подтверди код."
    );
    if (els.btnKiroRetry) {
      els.btnKiroRetry.disabled = true;
      els.btnKiroRetry.textContent = "Ждём…";
    }
    if (els.kiroModal) {
      els.kiroModal.classList.remove("hidden");
      els.kiroModal.setAttribute("aria-hidden", "false");
    }

    const ok = await openAwsWindow(kiroAuth.verificationUriComplete, { fresh: true });
    if (!ok) {
      setKiroWait(
        "wait",
        "Не удалось открыть AWS",
        "Нажми «Открыть / обновить AWS»."
      );
    }

    toast(`Код: ${r.userCode || "—"} · подтверди в чистом окне AWS`);
    if (kiroAuth.timer) clearTimeout(kiroAuth.timer);
    kiroAuth.timer = setTimeout(pollKiroLoop, 2500);
  } catch (e) {
    toast(String(e.message || e), true);
  } finally {
    if (els.btnOpenKiro) els.btnOpenKiro.disabled = false;
  }
}

function formatTokens(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

async function loadQuota() {
  const data = await fetch("/api/quota").then((r) => r.json());
  if (data.error) throw new Error(data.error);
  renderQuota(data);
  return data;
}

const kiroAuth = {
  timer: null,
  intervalMs: 5000,
  verificationUriComplete: "",
  active: false,
  awsWin: null,
};

function setKiroStatus(text, isErr = false) {
  if (!els.kiroStatus) return;
  els.kiroStatus.textContent = text;
  els.kiroStatus.style.color = isErr ? "var(--bad)" : "var(--muted)";
}

function setKiroWait(state, title, sub) {
  if (!els.kiroWait) return;
  els.kiroWait.classList.remove("done", "error");
  if (state === "done") els.kiroWait.classList.add("done");
  if (state === "error") els.kiroWait.classList.add("error");
  if (els.kiroWaitTitle && title) els.kiroWaitTitle.textContent = title;
  if (els.kiroWaitSub && sub) els.kiroWaitSub.textContent = sub;
}

/** Open AWS device auth in a clean browser profile (no saved Builder ID session). */
async function openAwsWindow(url, { fresh = true } = {}) {
  if (!url) return false;
  try {
    const r = await fetch("/api/kiro/open-aws", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, fresh }),
    }).then((x) => x.json());
    return Boolean(r.ok);
  } catch {
    try {
      const w = window.open(url, "kiro_aws_auth", "popup=yes,width=980,height=820");
      kiroAuth.awsWin = w;
      return Boolean(w);
    } catch {
      return false;
    }
  }
}

function closeKiroModal() {
  kiroAuth.active = false;
  if (kiroAuth.timer) {
    clearTimeout(kiroAuth.timer);
    kiroAuth.timer = null;
  }
  fetch("/api/kiro/cancel", { method: "POST" }).catch(() => {});
  if (els.kiroModal) {
    els.kiroModal.classList.add("hidden");
    els.kiroModal.setAttribute("aria-hidden", "true");
  }
  if (els.btnOpenKiro) els.btnOpenKiro.disabled = false;
}

async function pollKiroLoop() {
  if (!kiroAuth.active) return;
  try {
    const r = await fetch("/api/kiro/poll", { method: "POST" }).then((x) => x.json());
    if (!kiroAuth.active) return;
    if (r.success) {
      setKiroStatus("Подключено");
      setKiroWait("done", "Готово", "Kiro подключён. Выдаю ключ…");
      toast("Kiro подключён");
      kiroAuth.active = false;
      if (els.btnKiroRetry) {
        els.btnKiroRetry.disabled = false;
        els.btnKiroRetry.textContent = "Готово";
      }
      try {
        if (kiroAuth.awsWin && !kiroAuth.awsWin.closed) kiroAuth.awsWin.close();
      } catch {
        /* ignore */
      }
      if (r.keyIssued?.masked) {
        if (els.keyCurrent) els.keyCurrent.textContent = r.keyIssued.masked;
        if (els.apiKey) els.apiKey.placeholder = r.keyIssued.masked;
        toast(r.keyIssued.reused ? `Ключ: ${r.keyIssued.masked}` : `Ключ выдан: ${r.keyIssued.masked}`);
      } else if (r.keyIssued?.error) {
        toast(`Kiro ок, но ключ: ${r.keyIssued.error}`, true);
        // запасной путь — кнопка «Получить ключ»
        try {
          await generateKey();
        } catch {
          /* ignore */
        }
      } else {
        try {
          await generateKey();
        } catch {
          /* ignore */
        }
      }
      await loadQuota().catch(() => {});
      await refreshStatus().catch(() => {});
      setTab("models");
      // OmniRoute иногда отдаёт модели с небольшой задержкой после OAuth
      for (let i = 0; i < 5; i++) {
        try {
          await loadModels();
          if (state.models.length) break;
        } catch {
          /* retry */
        }
        await new Promise((r) => setTimeout(r, 1200));
      }
      setTimeout(closeKiroModal, 700);
      return;
    }
    if (r.pending || r.error === "authorization_pending" || r.error === "slow_down") {
      setKiroStatus(r.slowDown ? "AWS просит подождать…" : "Ждём подтверждение…");
      setKiroWait(
        "wait",
        "Ждём вход в AWS…",
        r.slowDown
          ? "AWS просит чуть подождать — продолжаем проверку."
          : "Подтверди код в окне AWS Access Portal. Статус здесь обновится сам."
      );
      const wait = r.slowDown ? Math.max(kiroAuth.intervalMs + 5000, 10000) : kiroAuth.intervalMs;
      kiroAuth.timer = setTimeout(pollKiroLoop, wait);
      return;
    }
    const msg = r.errorDescription || r.error || "Ошибка авторизации";
    setKiroStatus(msg, true);
    setKiroWait("error", "Не удалось завершить вход", msg + " — нажми «Повторить».");
    if (els.btnKiroRetry) {
      els.btnKiroRetry.disabled = false;
      els.btnKiroRetry.textContent = "Повторить";
    }
  } catch (e) {
    const msg = String(e.message || e);
    setKiroStatus(msg, true);
    setKiroWait("error", "Ошибка связи", msg);
    if (els.btnKiroRetry) {
      els.btnKiroRetry.disabled = false;
      els.btnKiroRetry.textContent = "Повторить";
    }
  }
}

function render() {
  updateLaunchButtons();
  updateLimitTicker();

  if (state.limit.limited || state.limit.banned) {
    els.grid.classList.add("dimmed");
  } else {
    els.grid.classList.remove("dimmed");
  }

  const list = visible();

  if (!list.length) {
    if (state.limit.limited || state.limit.banned) {
      els.grid.innerHTML = `<div class="empty limit-empty">Лимит Kiro · модели временно недоступны</div>`;
    } else if (!state.omniOnline) {
      els.grid.innerHTML = `<div class="empty">OmniRoute offline — открой Настройки → Установить недостающее</div>`;
    } else if (!state.models.length) {
      els.grid.innerHTML = `<div class="empty">Нет моделей — нажми «Стек» или «Обновить»</div>`;
    } else {
      els.grid.innerHTML = `<div class="empty">Ничего не найдено</div>`;
    }
    return;
  }

  els.grid.innerHTML = list
    .map((m) => {
      const testing = state.testing.has(m.id);
      const st = statusOf(m.id);
      const r = state.results[m.id];
      let meta;
      if (testing) {
        meta = `<div class="probe"><span class="probe-bars"><i></i><i></i><i></i><i></i></span> проверка…</div>`;
      } else if (state.limit.limited || state.limit.banned) {
        meta = state.limit.banned ? "аккаунт заблокирован" : "лимит аккаунта";
      } else if (r) {
        meta = r.ok
          ? `${r.ms} ms · ${esc((r.reply || "OK").slice(0, 36))}`
          : `${r.status || "err"} · ${esc((r.error || "ошибка").slice(0, 64))}`;
      } else {
        meta = "—";
      }
      const hasSession = Boolean(state.omniOnline && state.kiroConnected && !state.limit.banned);
      const selected = hasSession && m.id === state.activeModel;
      const locked = !hasSession || state.limit.limited;
      const actionBtn = selected
        ? `<button class="btn launch small" data-open="${esc(m.id)}" type="button" ${locked ? "disabled" : ""}>Открыть</button>`
        : `<button class="btn okish small" data-connect="${esc(m.id)}" type="button" ${testing || locked ? "disabled" : ""}>Подключить</button>`;
      return `<article class="card ${selected ? "selected" : ""} ${testing ? "testing" : ""} ${locked ? "limited" : ""}">
        <div class="card-top">
          <div style="display:flex;gap:10px;align-items:flex-start">
            ${modelIconHtml(m.id)}
            <div>
              <div class="id">${esc(m.id)}${selected ? '<span class="badge-on">ON</span>' : ""}</div>
              <div class="name">${esc(m.name)}</div>
            </div>
          </div>
          <div class="status ${st.cls}">${st.mark}</div>
        </div>
        <div class="meta">${meta}</div>
        <div class="row">
          <button class="btn ghost small" data-test="${esc(m.id)}" type="button" ${testing || locked ? "disabled" : ""}>Проверить</button>
          ${actionBtn}
        </div>
      </article>`;
    })
    .join("");
}

async function loadSetup() {
  const setup = await fetch("/api/setup").then((r) => r.json());
  renderSetup(setup);
  return setup;
}

async function refreshStatus() {
  const s = await fetch("/api/status").then((r) => r.json());
  renderConn(s);
  return s;
}

async function bootstrap() {
  els.foot.textContent = "";
  updateAuthButtons(false);
  // Status first — so F5 never sits on «Проверка…» while setup/quota crawl.
  try {
    await refreshStatus();
  } catch {
    renderConn({ omni: false });
  }
  await loadSetup().catch(() => {});
  try {
    const s = await fetch("/api/bootstrap", { method: "POST" }).then((r) => r.json());
    renderConn(s);
  } catch {
    /* keep last status */
  }
  await loadSetup().catch(() => {});
  await loadQuota().catch(() => {});
}

async function loadModels() {
  await refreshStatus();
  const res = await fetch("/api/models");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Не удалось загрузить модели");
  state.models = data.models || [];
  state.activeModel = data.activeModel || state.activeModel;
  els.foot.textContent = `${state.models.length} моделей`;
  render();
}

async function testModel(id) {
  if (!state.kiroConnected) {
    toast("Сначала войди в Kiro", true);
    return;
  }
  if (state.testing.has(id)) return;
  state.testing.add(id);
  render();
  try {
    const r = await fetch("/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: id }),
    }).then((x) => x.json());
    if (r && r.updateRequired) {
      showUpdateLock(r.telegram);
      return;
    }
    state.results[id] = r;
    save();
    const err = String(r?.error || "");
    if (!r.ok && /suspend|banned|locked your account|security precaution/i.test(err)) {
      toast("Kiro заблокировал аккаунт при проверке", true);
      await loadQuota().catch(() => {});
    } else if (r.ok) {
      toast(`OK · ${id}`);
    } else {
      toast(r.error || "Ошибка проверки", true);
    }
  } catch (e) {
    state.results[id] = { ok: false, error: String(e.message || e) };
    save();
    toast(String(e.message || e), true);
  } finally {
    state.testing.delete(id);
    render();
  }
}

async function connectModel(id) {
  if (!state.kiroConnected) {
    toast("Сначала войди в Kiro", true);
    return;
  }
  const r = await fetch("/api/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: id }),
  }).then((x) => x.json());
  if (!r.ok) {
    toast(r.error || "Ошибка", true);
    return;
  }
  state.activeModel = id;
  render();
  await refreshStatus();
  toast(`Подключено: ${id}`);
}

async function launchClaude() {
  if (!state.kiroConnected) {
    toast("Сначала войди в Kiro", true);
    return;
  }
  if (!state.activeModel) {
    toast("Сначала подключи модель", true);
    return;
  }
  [els.btnLaunch, els.btnLaunchBar].forEach((b) => b && (b.disabled = true));
  try {
    const r = await fetch("/api/launch", { method: "POST" }).then((x) => x.json());
    if (!r.ok) toast(r.error || "Не удалось открыть Claude", true);
    else toast(`Claude: ${r.model}`);
  } catch (e) {
    toast(String(e.message || e), true);
  } finally {
    updateLaunchButtons();
  }
}

async function saveKey() {
  const apiKey = els.apiKey.value.trim();
  if (!apiKey) {
    toast("Вставь ключ", true);
    return;
  }
  const r = await fetch("/api/key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  }).then((x) => x.json());
  if (!r.ok) {
    toast(r.error || "Ошибка", true);
    return;
  }
  els.apiKey.value = "";
  els.apiKey.placeholder = r.masked;
  if (els.keyCurrent) els.keyCurrent.textContent = r.masked;
  toast(`Ключ: ${r.masked}`);
  await loadSetup();
  await refreshStatus();
  loadQuota().catch(() => {});
}

async function generateKey() {
  if (!state.kiroConnected) {
    toast("Сначала войди в Kiro", true);
    updateAuthButtons(false);
    return;
  }
  els.btnGenKey.disabled = true;
  try {
    const r = await fetch("/api/key/generate", { method: "POST" }).then((x) => x.json());
    if (!r.ok) {
      toast(r.error || "Не удалось создать ключ", true);
      return;
    }
    if (els.keyCurrent) els.keyCurrent.textContent = r.masked;
    els.apiKey.placeholder = r.masked;
    toast(`Новый ключ: ${r.masked}`);
    if (r.key) {
      els.apiKey.value = "";
      els.apiKey.placeholder = r.masked;
    }
    await loadSetup();
    await refreshStatus();
    await loadQuota().catch(() => {});
  } finally {
    updateAuthButtons(state.kiroConnected);
  }
}

async function installAll() {
  els.installLogWrap.classList.remove("hidden");
  els.btnInstallAll.disabled = true;
  if (els.btnStopInstall) {
    els.btnStopInstall.classList.remove("hidden");
    els.btnStopInstall.disabled = false;
  }
  await fetch("/api/setup/install", { method: "POST" });
  if (state.setupPoll) clearInterval(state.setupPoll);
  state.setupPoll = setInterval(async () => {
    const setup = await loadSetup();
    if (!setup.install?.running) {
      clearInterval(state.setupPoll);
      state.setupPoll = null;
      if (els.btnStopInstall) els.btnStopInstall.classList.add("hidden");
      const stopped = setup.install?.step === "stopped";
      toast(
        stopped ? "Установка остановлена" : setup.install?.ok ? "Готово" : "Ошибка установки",
        !setup.install?.ok && !stopped
      );
      if (setup.install?.ok) {
        await bootstrap();
        try { await loadModels(); } catch {}
      }
    }
  }, 400);
}

async function stopInstall() {
  if (els.btnStopInstall) els.btnStopInstall.disabled = true;
  try {
    const r = await fetch("/api/setup/install/stop", { method: "POST" }).then((x) => x.json());
    toast(r.stopped ? r.message || "Останавливаю…" : r.message || "Стоп");
    await loadSetup();
  } catch (e) {
    toast(String(e.message || e), true);
    if (els.btnStopInstall) els.btnStopInstall.disabled = false;
  }
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => setTab(btn.dataset.tab));
});

document.querySelectorAll("[data-go]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const go = btn.getAttribute("data-go");
    if (go) setTab(go);
  });
});

els.grid.addEventListener("click", (e) => {
  const t = e.target.closest("[data-test]");
  const c = e.target.closest("[data-connect]");
  const o = e.target.closest("[data-open]");
  if (t) testModel(t.getAttribute("data-test"));
  if (c) connectModel(c.getAttribute("data-connect"));
  if (o) launchClaude();
});

els.search.addEventListener("input", () => {
  state.query = els.search.value.trim().toLowerCase();
  render();
});

document.getElementById("btnRefresh").addEventListener("click", () => {
  loadModels().catch((e) => {
    els.foot.textContent = e.message;
    els.grid.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  });
});
document.getElementById("btnLaunch").addEventListener("click", launchClaude);
document.getElementById("btnLaunchBar").addEventListener("click", launchClaude);
document.getElementById("btnSaveKey").addEventListener("click", saveKey);
document.getElementById("btnGenKey").addEventListener("click", generateKey);
document.getElementById("btnOpenKiro").addEventListener("click", openKiroAuth);
if (els.btnAwsSignOut) els.btnAwsSignOut.addEventListener("click", awsSignOut);
if (els.kiroModal) {
  els.kiroModal.addEventListener("click", (e) => {
    if (e.target && e.target.matches("[data-kiro-close]")) closeKiroModal();
  });
}
if (els.btnKiroOpenAws) {
  els.btnKiroOpenAws.addEventListener("click", async () => {
    if (!kiroAuth.verificationUriComplete) return;
    const ok = await openAwsWindow(kiroAuth.verificationUriComplete, { fresh: true });
    if (!ok) toast("Не удалось открыть окно AWS", true);
  });
}
if (els.btnKiroRetry) {
  els.btnKiroRetry.addEventListener("click", () => {
    if (els.btnKiroRetry.textContent === "Повторить") openKiroAuth();
  });
}
document.getElementById("btnInstallAll").addEventListener("click", installAll);
if (els.btnStopInstall) els.btnStopInstall.addEventListener("click", stopInstall);
if (els.btnLimitSwitch) {
  els.btnLimitSwitch.addEventListener("click", () => {
    setTab("setup");
    openKiroAuth();
  });
}
document.getElementById("btnBoot").addEventListener("click", async () => {
  await bootstrap();
  try { await loadModels(); } catch (e) { els.foot.textContent = e.message; }
});

const TELEGRAM_URL = "https://t.me/loveaideep";

function showUpdateLock(telegram) {
  const lock = document.getElementById("updateLock");
  const app = document.getElementById("appRoot");
  const btn = document.getElementById("btnUpdateTg");
  const url = telegram || TELEGRAM_URL;
  if (btn) btn.href = url;
  if (app) app.classList.add("hidden");
  if (lock) {
    lock.classList.remove("hidden");
    lock.setAttribute("aria-hidden", "false");
  }
  document.title = "FreeClaude · обновление";
}

async function ensureAccess() {
  try {
    const r = await fetch("/api/access?force=1", { signal: AbortSignal.timeout(2500) }).then((x) => x.json());
    if (r && r.allowed === false) {
      showUpdateLock(r.telegram);
      return false;
    }
    return true;
  } catch {
    // Pastebin/сеть тормозят — не блокируем UI на F5
    return true;
  }
}

(async () => {
  let savedTab = "home";
  try {
    const raw = localStorage.getItem("fc-tab");
    savedTab = raw === "models" || raw === "setup" || raw === "home" ? raw : "home";
  } catch {
    savedTab = "home";
  }
  // Paint tab + status immediately, access check in parallel (was blocking whole UI).
  setTab(savedTab);
  ensureLimitTimer();
  ensureQuotaPoll();
  const accessPromise = ensureAccess();
  try {
    await refreshStatus();
  } catch {
    renderConn({ omni: false });
  }
  const ok = await accessPromise;
  if (!ok) return;
  await bootstrap();
  try {
    await loadModels();
  } catch (e) {
    els.foot.textContent = e.message;
    els.grid.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
  await loadQuota().catch(() => {});
})();
