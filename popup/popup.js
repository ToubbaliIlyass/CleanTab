document.addEventListener("DOMContentLoaded", () => {

  // ── Tab navigation ─────────────────────────────────────────────────────────
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.add("hidden"));
      tab.classList.add("active");
      document.getElementById(`panel-${tab.dataset.tab}`)?.classList.remove("hidden");
      if (tab.dataset.tab === "sites") loadSites();
    });
  });

  function showView(viewClass) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("is-active"));
    document.querySelector(`.${viewClass}`)?.classList.add("is-active");
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function formatTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
  }

  function relTime(ts) {
    if (!ts) return "";
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  }

  function el(id) { return document.getElementById(id); }

  // ── Header badge (state + detection health, plan §9 Phase 19) ──────────────
  //
  // Never claims image analysis that isn't running. A broken classifier used to look
  // exactly like a working one.
  async function syncHeaderBadge() {
    const badge = el("statusBadge");
    if (!badge) return;

    const { enabled, disableUntil } = await storageGet(["enabled", "disableUntil"]);
    const paused = enabled === false || (disableUntil && disableUntil > Date.now());

    let label = "Active";
    let cls = "badge on";

    if (paused) {
      label = "Paused";
      cls = "badge off";
    } else {
      const health = await new Promise((r) =>
        chrome.runtime.sendMessage({ action: "getHealth" }, (res) =>
          r(chrome.runtime.lastError ? null : res)));
      if (health?.modelState === "unavailable") {
        label = "Text only";
        cls = "badge warn";
      }
    }

    badge.className = cls;
    badge.innerHTML = `<span class="badge-dot"></span><span class="badge-label"></span>`;
    badge.querySelector(".badge-label").textContent = label;

    el("disableBtn") && (el("disableBtn").style.display = paused ? "none" : "");
    el("enableBtn") && (el("enableBtn").style.display = paused ? "" : "none");
  }

  // ── Current site card (plan §9 Phase 17) ───────────────────────────────────

  let currentDomain = "";
  let currentTabId = null;

  async function loadSiteCard() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const pill = el("sitePill");
    const meta = el("siteMeta");
    const actions = el("siteActions");
    const favicon = el("siteFavicon");
    const domainEl = el("siteDomain");

    if (!tab?.url || !/^https?:/.test(tab.url)) {
      currentDomain = "";
      domainEl.textContent = tab?.url?.split("/")[0] || "This tab";
      pill.textContent = "Not scanned";
      pill.className = "site-pill neutral";
      // Say why, rather than implying coverage we don't have.
      meta.textContent = "CleanTab can't read browser pages, the PDF viewer or the Web Store.";
      actions.style.display = "none";
      favicon.textContent = "·";
      return;
    }

    currentTabId = tab.id;
    currentDomain = domainFromUrl(tab.url);
    domainEl.textContent = currentDomain;
    actions.style.display = "";
    favicon.style.display = "";
    // A letter mark, not a fetched favicon. Every favicon service is a remote request
    // keyed by the exact domain you are looking at, which is the one request this
    // extension must never make.
    favicon.textContent = (currentDomain[0] || "?").toUpperCase();

    const [{ trustedSites, enabled, disableUntil }, session] = await Promise.all([
      storageGet(["trustedSites", "enabled", "disableUntil"]),
      sessionGet(["tabVerdicts", "sitePauses"]),
    ]);

    const trusted = isTrusted(trustedSites, currentDomain);
    const pauseUntil = (session.sitePauses || {})[currentDomain];
    const paused = pauseUntil && pauseUntil > Date.now();
    const globallyOff = enabled === false || (disableUntil && disableUntil > Date.now());
    const verdict = (session.tabVerdicts || {})[tab.id];

    const trustBtn = el("trustBtn");
    const pauseBtn = el("pauseSiteBtn");

    if (globallyOff) {
      pill.textContent = "Protection off";
      pill.className = "site-pill neutral";
      meta.textContent = "CleanTab is paused everywhere.";
    } else if (trusted) {
      pill.textContent = "Trusted";
      pill.className = "site-pill trusted";
      meta.textContent = "Never scanned. You added this site to your trust list.";
    } else if (paused) {
      pill.textContent = "Paused here";
      pill.className = "site-pill neutral";
      meta.textContent = `Resumes in ${Math.ceil((pauseUntil - Date.now()) / 60000)} min.`;
    } else {
      pill.textContent = "Protected";
      pill.className = "site-pill protected";
      meta.textContent = verdict
        ? `Scanned ${relTime(verdict.ts)} · risk ${verdict.score} of 5`
        : "Waiting for the first scan of this page…";
    }

    trustBtn.textContent = trusted ? "Stop trusting" : "Trust site";
    pauseBtn.textContent = paused ? "Resume here" : "Pause here";
    pauseBtn.disabled = Boolean(globallyOff || trusted);
  }

  el("trustBtn")?.addEventListener("click", async () => {
    if (!currentDomain) return;
    const { trustedSites } = await storageGet(["trustedSites"]);
    if (isTrusted(trustedSites, currentDomain)) await removeTrustedSite(currentDomain);
    else await addTrustedSite(currentDomain, "manual");
    await loadSiteCard();
    if (currentTabId) chrome.tabs.reload(currentTabId);
  });

  el("pauseSiteBtn")?.addEventListener("click", async () => {
    if (!currentDomain) return;
    const pauseUntil = await getSitePause(currentDomain);
    if (pauseUntil) {
      await clearSitePause(currentDomain);
      el("pauseOpts").style.display = "none";
      await loadSiteCard();
      return;
    }
    const opts = el("pauseOpts");
    opts.style.display = opts.style.display === "none" ? "flex" : "none";
  });

  document.querySelectorAll(".pause-opt").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const raw = btn.dataset.ms;
      let ms;
      if (raw === "today") {
        const end = new Date();
        end.setHours(23, 59, 59, 999);
        ms = end - Date.now();
      } else {
        ms = parseInt(raw, 10);
      }
      await pauseSite(currentDomain, ms);
      el("pauseOpts").style.display = "none";
      await loadSiteCard();
      if (currentTabId) chrome.tabs.reload(currentTabId);
    });
  });

  // ── Ring: clean share, minutes as context ──────────────────────────────────
  const CIRC = 376.99; // 2π × r=60

  async function updateRingDisplay() {
    const { today = {}, cleanShareGoal = 0.95, totals = {} } =
      await storageGet(["today", "cleanShareGoal", "totals"]);

    const browsed = today.browsedMinutes || 0;
    const clean = today.cleanMinutes || 0;
    const share = cleanShare(today);
    const closed = ringIsClosed(today, cleanShareGoal);

    const fill = el("ringFill");
    const pctEl = el("ringPct");
    const sub = el("ringSub");
    const ctx = el("ringContext");

    if (fill) fill.setAttribute("stroke-dasharray", `${share * CIRC} ${CIRC}`);

    if (!browsed) {
      // A ratio of nothing is not 0% — it's undefined. Saying "0%" on a fresh day
      // would read as failure before anything has happened.
      if (pctEl) pctEl.textContent = "—";
      if (sub) sub.textContent = "clean today";
      if (ctx) ctx.textContent = "No browsing tracked yet today.";
    } else {
      if (pctEl) pctEl.textContent = `${Math.round(share * 100)}%`;
      if (sub) sub.textContent = closed ? "ring closed" : "clean today";
      if (ctx) {
        ctx.textContent = closed
          ? `${clean} clean of ${browsed} min browsed — closed.`
          : browsed < MIN_BROWSED_FOR_CLOSE
            ? `${clean} clean of ${browsed} min browsed · ${MIN_BROWSED_FOR_CLOSE - browsed} more min to qualify`
            : `${clean} clean of ${browsed} min browsed · ${Math.round(cleanShareGoal * 100)}% needed`;
      }
    }

    el("todayRedirects").textContent = today.redirects ?? 0;
    el("closedDays").textContent = totals.closedDays ?? 0;
    el("reflectionsTotal").textContent = totals.reflectionsLogged ?? 0;
  }

  // ── Inline insight ─────────────────────────────────────────────────────────
  const CHIPS = { bored:"Bored", stressed:"Stressed", habit:"Habit", avoiding:"Avoiding", lonely:"Lonely", tired:"Tired" };

  function countTriggers(reflections) {
    const counts = {};
    Object.keys(CHIPS).forEach((k) => { counts[k] = 0; });
    reflections.forEach((r) => { if (counts[r.chip] !== undefined) counts[r.chip]++; });
    return counts;
  }

  async function updateInlineInsight() {
    const { reflections = [] } = await storageGet(["reflections"]);
    const box = el("insightInline");
    if (!box) return;
    if (reflections.length < 10) { box.style.display = "none"; return; }

    const counts = countTriggers(reflections);
    const [chip, count] = Object.entries(counts).sort(([, a], [, b]) => b - a)[0];
    if (!count) { box.style.display = "none"; return; }

    el("insightText").textContent =
      `Most common trigger: ${CHIPS[chip]} · ${Math.round((count / reflections.length) * 100)}%`;
    box.style.display = "";
  }

  // ── Sites tab (plan §9 Phase 18) ───────────────────────────────────────────

  function sourceLabel(entry) {
    if (typeof entry === "string") return "legacy";
    if (entry.source === "appeal-legacy") return "auto-approved before v0.2 — worth reviewing";
    if (entry.source === "appeal") return "approved by image check";
    return "added by you";
  }

  async function loadSites() {
    const { trustedSites = [], blocks = [] } = await storageGet(["trustedSites", "blocks"]);

    const list = el("trustedList");
    list.innerHTML = "";
    if (!trustedSites.length) {
      const empty = document.createElement("p");
      empty.className = "empty-note";
      empty.textContent = "Nothing trusted yet. Sites you allow from a block page land here.";
      list.appendChild(empty);
    }

    trustedSites.forEach((entry) => {
      const domain = trustEntryDomain(entry);
      const row = document.createElement("div");
      row.className = "site-row";

      const info = document.createElement("div");
      info.className = "site-row-info";
      const name = document.createElement("span");
      name.className = "site-row-domain";
      name.textContent = domain;
      const sub = document.createElement("span");
      sub.className = "site-row-sub";
      const added = typeof entry === "string" ? null : entry.addedAt;
      sub.textContent = added ? `${sourceLabel(entry)} · ${relTime(added)}` : sourceLabel(entry);
      info.append(name, sub);

      const remove = document.createElement("button");
      remove.className = "row-btn";
      remove.textContent = "Remove";
      remove.addEventListener("click", async () => {
        await removeTrustedSite(domain);
        loadSites();
      });

      row.append(info, remove);
      list.appendChild(row);
    });

    const blockList = el("blockList");
    blockList.innerHTML = "";
    if (!blocks.length) {
      const empty = document.createElement("p");
      empty.className = "empty-note";
      empty.textContent = "No blocks recorded yet.";
      blockList.appendChild(empty);
    }

    blocks.slice(0, 10).forEach((b) => {
      const row = document.createElement("div");
      row.className = "site-row";

      const info = document.createElement("div");
      info.className = "site-row-info";
      const name = document.createElement("span");
      name.className = "site-row-domain";
      name.textContent = b.domain || "unknown";
      const sub = document.createElement("span");
      sub.className = "site-row-sub";
      sub.textContent = `${b.reason} · ${relTime(b.ts)}`;
      info.append(name, sub);

      const trust = document.createElement("button");
      trust.className = "row-btn";
      trust.textContent = "Trust";
      trust.addEventListener("click", async () => {
        await addTrustedSite(b.domain, "manual");
        loadSites();
      });

      row.append(info, trust);
      blockList.appendChild(row);
    });
  }

  el("addSiteBtn")?.addEventListener("click", async () => {
    const input = el("addSiteInput");
    const raw = input.value.trim();
    if (!raw) return;
    // Accept a pasted URL as readily as a bare hostname.
    const domain = raw.includes("://") ? domainFromUrl(raw) : normalizeDomain(raw);
    if (!domain || !domain.includes(".")) {
      input.value = "";
      input.placeholder = "Enter a domain like example.com";
      return;
    }
    await addTrustedSite(domain, "manual");
    input.value = "";
    loadSites();
  });

  el("addSiteInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") el("addSiteBtn").click();
  });

  // ── Sensitivity (plan §9 Phase 16) ─────────────────────────────────────────

  async function renderSensitivity() {
    const { sensitivity = DEFAULT_SENSITIVITY, enableDwellDetection = false } =
      await storageGet(["sensitivity", "enableDwellDetection"]);

    const list = el("sensList");
    list.innerHTML = "";

    Object.entries(SENSITIVITY_PROFILES).forEach(([key, profile]) => {
      const btn = document.createElement("button");
      btn.className = "sens-btn" + (key === sensitivity ? " selected" : "");
      const title = document.createElement("span");
      title.className = "sens-title";
      title.textContent = profile.label;
      const sub = document.createElement("span");
      sub.className = "sens-sub";
      sub.textContent = profile.blurb;
      btn.append(title, sub);
      btn.addEventListener("click", async () => {
        await storageSet({ sensitivity: key });
        renderSensitivity();
      });
      list.appendChild(btn);
    });

    const toggle = el("dwellToggle");
    if (toggle) {
      toggle.checked = Boolean(enableDwellDetection);
      // Lenient turns image scanning off as part of the profile; reflect that honestly
      // rather than showing a toggle that does nothing.
      toggle.disabled = !getProfile(sensitivity).dwell;
    }
  }

  el("dwellToggle")?.addEventListener("change", async (e) => {
    await storageSet({ enableDwellDetection: e.target.checked });
  });

  // ── Init ───────────────────────────────────────────────────────────────────

  (async () => {
    await syncHeaderBadge();
    await loadSiteCard();
    await updateRingDisplay();
    await updateInlineInsight();
    await renderSensitivity();
    await renderLockStrength();
    await loadProgress();

    const data = await storageGet(["enabled", "cooldownUntil", "disableUntil"]);
    if (data.enabled !== false && data.cooldownUntil) {
      if (data.cooldownUntil > Date.now()) {
        showView("view-cooldown");
        startCooldownTimer(data.cooldownUntil);
      } else {
        showView("view-reenter");
      }
    }
    if (data.enabled === false && data.disableUntil && data.disableUntil > Date.now()) {
      startDisableTimer(data.disableUntil);
    }
  })();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.today || changes.totals || changes.cleanShareGoal) updateRingDisplay();
    if (changes.history || changes.reflections || changes.today) loadProgress();
    if (changes.reflections) updateInlineInsight();
    if (changes.trustedSites) { loadSiteCard(); loadSites(); }
    if (changes.enabled || changes.disableUntil) { syncHeaderBadge(); loadSiteCard(); }
  });

  // ── Disable flow ───────────────────────────────────────────────────────────
  //
  // Four gates, in order: administrator policy, the user's own lock window, an
  // accountability partner's passphrase, then the escalating cooldown. Any one of the
  // first two can remove the off switch outright, which is why there is a screen that
  // says so rather than a button that quietly does nothing.

  async function loadManaged() {
    // storage.managed is empty unless an admin set a policy. It can also throw on
    // platforms without policy support, so absence must never break the popup.
    try {
      return await new Promise((resolve) => {
        chrome.storage.managed.get(null, (values) => {
          void chrome.runtime.lastError;
          resolve(values || {});
        });
      });
    } catch {
      return {};
    }
  }

  async function handleDisableFlow() {
    const data = await storageGet([
      "enabled", "cooldownUntil", "partnerLockHash", "partnerLockLabel", "lockWindow",
    ]);
    if (data.enabled === false) { showView("view-normal"); return; }

    const managed = await loadManaged();
    const permission = disablePermission(data, managed);

    if (!permission.allowed) {
      el("lockedTitle").textContent = permission.reason === "managed"
        ? "Locked by your administrator"
        : "Outside your unlock hours";
      el("lockedDetail").textContent = permission.detail;
      showView("view-locked");
      return;
    }

    // Mid-flow states resume where they left off.
    if (data.cooldownUntil) {
      if (data.cooldownUntil > Date.now()) {
        showView("view-cooldown");
        startCooldownTimer(data.cooldownUntil);
      } else {
        showView("view-reenter");
      }
      return;
    }

    // The partner gate comes before the wait, so the wait is not spent by someone who
    // was never going to get through it.
    if (data.partnerLockHash) {
      el("partnerPrompt").textContent = permission.detail;
      el("partnerInput").value = "";
      el("partnerError").style.display = "none";
      el("partnerContinue").disabled = true;
      el("partnerContinue").classList.add("disabled");
      showView("view-partner");
      return;
    }

    await showConfirmWithCooldown();
  }

  async function showConfirmWithCooldown() {
    const { disableEvents } = await storageGet(["disableEvents"]);
    const ms = computeCooldownMs(disableEvents);
    const recent = recentDisableCount(disableEvents);
    const desc = el("confirmDesc");
    if (desc) {
      desc.innerHTML = recent > 0
        ? `A <strong>${describeCooldown(ms)} cooldown</strong> prevents impulsive decisions. ` +
          `It doubled because you disabled protection ${recent} time${recent === 1 ? "" : "s"} this week.`
        : `A <strong>${describeCooldown(ms)} cooldown</strong> prevents impulsive decisions. ` +
          `You'll need to type a passphrase twice.`;
    }
    showView("view-confirm");
  }

  el("disableBtn")?.addEventListener("click", handleDisableFlow);
  el("confirmCancel")?.addEventListener("click", () => showView("view-normal"));
  el("cancelLocked")?.addEventListener("click", () => showView("view-normal"));
  el("cancelPartner")?.addEventListener("click", () => showView("view-normal"));

  // ── Partner gate ───────────────────────────────────────────────────────────
  const partnerInput = el("partnerInput");
  const partnerContinue = el("partnerContinue");

  partnerInput?.addEventListener("input", () => {
    const ready = partnerInput.value.trim().length > 0;
    partnerContinue.disabled = !ready;
    partnerContinue.classList.toggle("disabled", !ready);
    el("partnerError").style.display = "none";
  });
  // Same reasoning as the typed passphrase: pasting defeats the point of recall.
  partnerInput?.addEventListener("paste", (e) => e.preventDefault());
  partnerInput?.addEventListener("drop", (e) => e.preventDefault());

  partnerContinue?.addEventListener("click", async () => {
    const { partnerLockHash } = await storageGet(["partnerLockHash"]);
    const ok = await partnerPassphraseMatches(partnerInput.value, partnerLockHash);
    if (!ok) {
      el("partnerError").style.display = "";
      partnerInput.value = "";
      partnerContinue.disabled = true;
      partnerContinue.classList.add("disabled");
      return;
    }
    if (partnerRemovalPending) {
      partnerRemovalPending = false;
      await storageSet({ partnerLockHash: null, partnerLockLabel: null });
      await renderLockStrength();
      showView("view-normal");
      return;
    }
    await showConfirmWithCooldown();
  });

  el("confirmContinue")?.addEventListener("click", async () => {
    const { cooldownUntil } = await storageGet(["cooldownUntil"]);
    if (cooldownUntil && cooldownUntil > Date.now()) {
      showView("view-cooldown");
      startCooldownTimer(cooldownUntil);
    } else {
      assignNewPassphrase();
      showView("view-passphrase");
    }
  });
  el("cancelPassphrase")?.addEventListener("click", () => showView("view-normal"));
  el("cancelCooldown")?.addEventListener("click", async () => {
    await storageRemove("cooldownUntil");
    if (cooldownInterval) clearInterval(cooldownInterval);
    showView("view-normal");
  });
  el("cancelReenter")?.addEventListener("click", async () => {
    await storageRemove("cooldownUntil");
    showView("view-normal");
  });
  el("cancelDuration")?.addEventListener("click", () => showView("view-normal"));

  el("enableBtn")?.addEventListener("click", async () => {
    await storageRemove("disableUntil");
    await storageSet({ enabled: true });
    if (disableTimerInterval) clearInterval(disableTimerInterval);
    await syncHeaderBadge();
    await loadSiteCard();
    el("ringCard").style.display = "";
    el("disableTimerCard").style.display = "none";
  });

  // ── Passphrase ─────────────────────────────────────────────────────────────
  // Friction, not security — the pool is visible in source by design.
  const PASSPHRASES = [
    "I choose long-term focus over short-term impulse.",
    "The discomfort I feel now is smaller than the regret I'd feel later.",
    "Discipline is choosing what I want most over what I want right now.",
    "I am in control of where my attention goes.",
    "This moment of resistance is building something real.",
    "I respect my own time and energy.",
    "What I do right now shapes who I become.",
    "The urge will pass. My focus stays.",
  ];

  let activePassphrase = PASSPHRASES[0];

  function assignNewPassphrase() {
    activePassphrase = PASSPHRASES[Math.floor(Math.random() * PASSPHRASES.length)];
    document.querySelectorAll(".passphrase-box").forEach((e) => { e.textContent = activePassphrase; });
    document.querySelectorAll(".view-passphrase .text-input, .view-reenter .text-input").forEach((e) => { e.value = ""; });
    document.querySelectorAll(".view-passphrase .flow-actions .btn:last-child, .view-reenter .flow-actions .btn:last-child").forEach((btn) => {
      btn.disabled = true; btn.classList.add("disabled");
    });
  }

  function wirePassphrase(viewSel, onSuccess) {
    const input = document.querySelector(`${viewSel} .text-input`);
    const btn = document.querySelector(`${viewSel} .flow-actions .btn:last-child`);
    if (!input || !btn) return;
    input.addEventListener("input", () => {
      const match = input.value.trim() === activePassphrase;
      btn.disabled = !match;
      btn.classList.toggle("disabled", !match);
    });
    input.addEventListener("paste", (e) => e.preventDefault());
    input.addEventListener("drop", (e) => e.preventDefault());
    btn.addEventListener("click", () => { if (!btn.disabled) onSuccess(); });
  }

  wirePassphrase(".view-passphrase", async () => {
    const { disableEvents } = await storageGet(["disableEvents"]);
    const until = Date.now() + computeCooldownMs(disableEvents);
    await storageSet({ cooldownUntil: until });
    showView("view-cooldown");
    startCooldownTimer(until);
  });

  wirePassphrase(".view-reenter", async () => {
    await storageRemove("cooldownUntil");
    showView("view-duration");
  });

  // ── Timers ─────────────────────────────────────────────────────────────────
  let cooldownInterval = null;
  let disableTimerInterval = null;

  function startCooldownTimer(until) {
    const e = el("cooldown-timer");
    if (!e) return;
    if (cooldownInterval) clearInterval(cooldownInterval);
    function tick() {
      const rem = until - Date.now();
      if (rem <= 0) {
        clearInterval(cooldownInterval);
        e.textContent = "0h 0m 0s";
        showView("view-reenter");
        return;
      }
      e.textContent = formatTime(rem);
    }
    tick();
    cooldownInterval = setInterval(tick, 1000);
  }

  function startDisableTimer(until) {
    const e = el("disableTimer");
    const rc = el("ringCard");
    const tc = el("disableTimerCard");
    if (!e) return;
    if (rc) rc.style.display = "none";
    if (tc) tc.style.display = "flex";
    if (disableTimerInterval) clearInterval(disableTimerInterval);
    function tick() {
      const rem = until - Date.now();
      if (rem <= 0) {
        clearInterval(disableTimerInterval);
        storageRemove("disableUntil")
          .then(() => storageSet({ enabled: true }))
          .then(async () => {
            await syncHeaderBadge();
            if (rc) rc.style.display = "";
            if (tc) tc.style.display = "none";
          });
        return;
      }
      const m = Math.floor(rem / 60000);
      const s = Math.floor((rem % 60000) / 1000);
      e.textContent = `${m}:${String(s).padStart(2, "0")}`;
    }
    tick();
    disableTimerInterval = setInterval(tick, 1000);
  }

  document.querySelectorAll(".dur-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const mins = parseInt(btn.dataset.minutes, 10);
      const until = Date.now() + mins * 60 * 1000;
      // Recorded here, at the moment protection actually goes off, so the next cooldown
      // escalates. Abandoning the flow earlier costs nothing.
      const { disableEvents } = await storageGet(["disableEvents"]);
      await storageSet({
        enabled: false,
        disableUntil: until,
        disableEvents: recordDisableEvent(disableEvents),
      });
      showView("view-normal");
      await syncHeaderBadge();
      startDisableTimer(until);
    });
  });


  // ── Lock strength controls ─────────────────────────────────────────────────

  function hourOptions(select, selected) {
    if (!select) return;
    select.innerHTML = "";
    for (let h = 0; h < 24; h++) {
      const opt = document.createElement("option");
      opt.value = String(h);
      opt.textContent = formatHour(h);
      if (h === Number(selected)) opt.selected = true;
      select.appendChild(opt);
    }
  }

  async function renderLockStrength() {
    const data = await storageGet([
      "partnerLockHash", "partnerLockLabel", "lockWindow", "disableEvents",
    ]);
    const managed = await loadManaged();

    const partnerState = el("partnerState");
    if (partnerState) {
      partnerState.textContent = data.partnerLockHash
        ? `${data.partnerLockLabel || "Someone you trust"} holds the passphrase.`
        : "Nobody holds the passphrase yet.";
    }
    const setupBtn = el("partnerSetupBtn");
    if (setupBtn) setupBtn.textContent = data.partnerLockHash ? "Remove" : "Set up";

    const lockWindow = data.lockWindow || { enabled: false, startHour: 22, endHour: 6 };
    const windowToggle = el("windowToggle");
    if (windowToggle) windowToggle.checked = Boolean(lockWindow.enabled);
    const windowState = el("windowState");
    if (windowState) {
      windowState.textContent = lockWindow.enabled
        ? `No off switch between ${describeLockWindow(lockWindow)}.`
        : "Off — you can disable protection any time.";
    }
    const windowSetup = el("windowSetup");
    if (windowSetup) windowSetup.style.display = lockWindow.enabled ? "" : "none";
    hourOptions(el("windowStart"), lockWindow.startHour);
    hourOptions(el("windowEnd"), lockWindow.endHour);

    // Escalation state, so the number in the Protection block is never a surprise.
    const disableDesc = el("disableDesc");
    if (disableDesc) {
      const ms = computeCooldownMs(data.disableEvents);
      const recent = recentDisableCount(data.disableEvents);
      disableDesc.textContent = recent > 0
        ? `Next cooldown is ${describeCooldown(ms)} — it doubles each time you disable protection within a week.`
        : `Disabling requires a passphrase and a ${describeCooldown(ms)} cooldown that doubles on repeat use.`;
    }

    // An administrator's values are read-only. Say so rather than presenting a control
    // that silently refuses.
    const note = el("managedNote");
    const lockedKeys = MANAGEABLE_KEYS.filter((k) => isSettingManaged(managed, k));
    if (note) {
      if (lockedKeys.length) {
        note.style.display = "";
        note.textContent = managed.allowDisable === false
          ? "Managed by your administrator. Protection cannot be disabled on this device."
          : `Managed by your administrator: ${lockedKeys.join(", ")}.`;
      } else {
        note.style.display = "none";
      }
    }
    if (isSettingManaged(managed, "allowDisable") && managed.allowDisable === false) {
      el("disableBtn")?.setAttribute("disabled", "true");
    }
    if (isSettingManaged(managed, "enableDwellDetection")) {
      el("dwellToggle")?.setAttribute("disabled", "true");
    }
    if (isSettingManaged(managed, "sensitivity")) {
      document.querySelectorAll("#sensList input, #sensList button").forEach((e) =>
        e.setAttribute("disabled", "true"));
    }
  }

  // Partner setup / removal
  let partnerRemovalPending = false;

  el("partnerSetupBtn")?.addEventListener("click", async () => {
    const { partnerLockHash } = await storageGet(["partnerLockHash"]);
    if (partnerLockHash) {
      // Removing the lock is itself a disable-shaped action, so it goes through the
      // partner gate rather than being a one-click undo.
      el("partnerPrompt").textContent = "Your partner must enter their passphrase to remove the lock.";
      el("partnerInput").value = "";
      el("partnerError").style.display = "none";
      partnerRemovalPending = true;
      showView("view-partner");
      return;
    }
    const setup = el("partnerSetup");
    if (setup) setup.style.display = setup.style.display === "none" ? "" : "none";
  });

  function validatePartnerSetup() {
    const phrase = el("partnerNew")?.value || "";
    const confirm = el("partnerConfirm")?.value || "";
    const save = el("partnerSetupSave");
    const error = el("partnerSetupError");
    let message = "";
    if (phrase && !isValidPartnerPassphrase(phrase)) {
      message = `At least ${PARTNER_MIN_LENGTH} characters.`;
    } else if (phrase && confirm && normalizePassphrase(phrase) !== normalizePassphrase(confirm)) {
      message = "The two entries don't match.";
    }
    if (error) {
      error.textContent = message;
      error.style.display = message ? "" : "none";
    }
    const ready = isValidPartnerPassphrase(phrase) &&
      normalizePassphrase(phrase) === normalizePassphrase(confirm);
    if (save) save.disabled = !ready;
  }

  ["partnerNew", "partnerConfirm"].forEach((id) => {
    el(id)?.addEventListener("input", validatePartnerSetup);
  });

  el("partnerSetupCancel")?.addEventListener("click", () => {
    el("partnerSetup").style.display = "none";
    ["partnerName", "partnerNew", "partnerConfirm"].forEach((id) => {
      const e = el(id);
      if (e) e.value = "";
    });
    el("partnerSetupError").style.display = "none";
  });

  el("partnerSetupSave")?.addEventListener("click", async () => {
    const phrase = el("partnerNew").value;
    if (!isValidPartnerPassphrase(phrase)) return;
    await storageSet({
      partnerLockHash: await hashPassphrase(phrase),
      partnerLockLabel: el("partnerName").value.trim() || null,
    });
    el("partnerSetup").style.display = "none";
    ["partnerName", "partnerNew", "partnerConfirm"].forEach((id) => {
      const e = el(id);
      if (e) e.value = "";
    });
    await renderLockStrength();
  });

  // Lock window
  el("windowToggle")?.addEventListener("change", async (e) => {
    const { lockWindow } = await storageGet(["lockWindow"]);
    const next = { ...(lockWindow || { startHour: 22, endHour: 6 }), enabled: e.target.checked };
    // Turning the window OFF while inside it would defeat the whole mechanism.
    if (!e.target.checked && isWithinLockWindow(lockWindow)) {
      e.target.checked = true;
      el("windowState").textContent =
        `Can't switch this off during the window itself (${describeLockWindow(lockWindow)}).`;
      return;
    }
    await storageSet({ lockWindow: next });
    await renderLockStrength();
  });

  ["windowStart", "windowEnd"].forEach((id) => {
    el(id)?.addEventListener("change", async () => {
      const { lockWindow } = await storageGet(["lockWindow"]);
      if (isWithinLockWindow(lockWindow)) {
        await renderLockStrength();
        return; // no editing the window from inside it
      }
      await storageSet({
        lockWindow: {
          ...(lockWindow || {}),
          enabled: true,
          startHour: Number(el("windowStart").value),
          endHour: Number(el("windowEnd").value),
        },
      });
      await renderLockStrength();
    });
  });

  // ── Heatmap ────────────────────────────────────────────────────────────────
  // Coloured by clean SHARE, matching the ring. A day with no tracked browsing is
  // blank rather than dark — it is an absence, not a bad day.
  function renderHeatmap(history, todayData) {
    const grid = el("heatmapGrid");
    if (!grid) return;
    grid.innerHTML = "";

    const todayKey = todayLocal();
    const today = new Date();
    const dow = (today.getDay() + 6) % 7; // Mon=0 … Sun=6
    const gridEnd = new Date(today);
    gridEnd.setDate(gridEnd.getDate() + (6 - dow));

    const TOTAL = 16 * 7;

    for (let i = TOTAL - 1; i >= 0; i--) {
      const d = new Date(gridEnd);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const isFuture = d > today;

      const cell = document.createElement("div");
      cell.className = "hm-cell";

      if (isFuture) {
        cell.style.background = "transparent";
        cell.style.border = "1px solid #EEEBE5";
        grid.appendChild(cell);
        continue;
      }

      const day = key === todayKey ? todayData : history[key];
      const browsed = day?.browsedMinutes || 0;

      if (!browsed) {
        cell.style.background = "#F5F3EF";
        cell.title = `${key} — no browsing tracked`;
        grid.appendChild(cell);
        continue;
      }

      const share = cleanShare(day);
      cell.title = `${key} — ${Math.round(share * 100)}% clean of ${browsed} min`;

      if (share >= 0.95)      cell.style.background = "#FF6B35";
      else if (share >= 0.85) cell.style.background = "#FFAA7A";
      else if (share >= 0.7)  cell.style.background = "#FFD0B5";
      else if (share >= 0.5)  cell.style.background = "#FFE9DB";
      else                    cell.style.background = "#F0EDE7";

      grid.appendChild(cell);
    }
  }

  function renderInsights(reflections) {
    const section = el("insightsSection");
    const emptyEl = el("insightsEmpty");
    const bars = el("triggerBars");
    if (!section || !bars) return;

    if (reflections.length < 10) {
      section.style.display = "none";
      if (emptyEl) emptyEl.style.display = "";
      return;
    }

    if (emptyEl) emptyEl.style.display = "none";
    section.style.display = "flex";
    bars.innerHTML = "";

    const counts = countTriggers(reflections);
    const total = reflections.length || 1;
    const max = Math.max(...Object.values(counts), 1);

    Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .filter(([, c]) => c > 0)
      .forEach(([chip, count]) => {
        const row = document.createElement("div");
        row.className = "trigger-bar";

        const name = document.createElement("span");
        name.className = "trigger-name";
        name.textContent = CHIPS[chip];

        const track = document.createElement("div");
        track.className = "trigger-track";
        const bar = document.createElement("div");
        bar.className = "trigger-fill";
        bar.style.width = `${(count / max) * 100}%`;
        track.appendChild(bar);

        const pct = document.createElement("span");
        pct.className = "trigger-pct";
        pct.textContent = `${Math.round((count / total) * 100)}%`;

        row.append(name, track, pct);
        bars.appendChild(row);
      });
  }

  async function loadProgress() {
    const { history = {}, today = {}, reflections = [] } =
      await storageGet(["history", "today", "reflections"]);
    renderHeatmap(history, today);
    renderInsights(reflections);
  }

  // ── Export / Import ────────────────────────────────────────────────────────
  el("exportBtn")?.addEventListener("click", async () => {
    const data = await storageGet(null);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {
      href: url, download: `cleantab-${todayLocal()}.json`,
    });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  el("importBtn")?.addEventListener("click", () => el("importFile")?.click());

  // Only keys the schema defines are written. The old version handed whatever JSON it was
  // given straight to storage after checking a single truthy field.
  const IMPORTABLE = new Set(Object.keys(getDefaults(todayLocal())).concat(["firstRedirectSeen"]));

  el("importFile")?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.schemaVersion) throw new Error("not a CleanTab backup");

        const clean = {};
        for (const [k, v] of Object.entries(data)) {
          if (IMPORTABLE.has(k)) clean[k] = v;
        }
        if (clean.schemaVersion === 1) Object.assign(clean, migrateV1ToV2(clean));

        await storageSet(clean);
        alert("Data restored. Reopen the popup.");
      } catch (err) {
        alert("Invalid CleanTab backup file.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

});
