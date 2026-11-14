document.addEventListener("DOMContentLoaded", () => {

  // ── Tab navigation ─────────────────────────────────────────────────────────
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
      });
      document.querySelectorAll(".panel").forEach((p) => p.classList.add("hidden"));
      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");
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
      label = "Off";
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

    const [{ trustedSites, enabled, disableUntil, blockedSites }, session] = await Promise.all([
      storageGet(["trustedSites", "enabled", "disableUntil", "blockedSites"]),
      sessionGet(["tabVerdicts", "sitePauses"]),
    ]);

    const trusted = isTrusted(trustedSites, currentDomain);
    const pauseUntil = (session.sitePauses || {})[currentDomain];
    const paused = pauseUntil && pauseUntil > Date.now();
    const userBlocked = isUserBlocked(blockedSites, currentDomain);
    const globallyOff = enabled === false || (disableUntil && disableUntil > Date.now());
    const verdict = (session.tabVerdicts || {})[tab.id];

    const trustBtn = el("trustBtn");
    const pauseBtn = el("pauseSiteBtn");

    if (globallyOff) {
      pill.textContent = "Protection off";
      pill.className = "site-pill neutral";
      meta.textContent = "CleanTab is switched off everywhere for now.";
    } else if (userBlocked) {
      pill.textContent = "Blocked by you";
      pill.className = "site-pill neutral";
      meta.textContent = "You blocked this site. It stays blocked, including its subdomains.";
    } else if (trusted) {
      pill.textContent = "Trusted";
      pill.className = "site-pill trusted";
      meta.textContent = "Never scanned. You added this site to your trust list.";
    } else if (paused) {
      pill.textContent = "Skipped";
      pill.className = "site-pill neutral";
      meta.textContent = `Not checked on this site for another ${Math.ceil((pauseUntil - Date.now()) / 60000)} min.`;
    } else {
      pill.textContent = "Protected";
      pill.className = "site-pill protected";
      meta.textContent = verdict
        ? `Scanned ${relTime(verdict.ts)} · risk ${verdict.score} of 5`
        : "Waiting for the first scan of this page…";
    }

    // A site on the adult list cannot be trusted or skipped: lists are decided in advance.
    const adult = isKnownAdultDomain(currentDomain);
    trustBtn.textContent = trusted ? "Stop trusting" : "Trust site";
    trustBtn.disabled = adult && !trusted;
    pauseBtn.textContent = paused ? "Check again" : "Skip this site";
    pauseBtn.disabled = Boolean(globallyOff || trusted || userBlocked || adult);
    if (adult && !globallyOff && !userBlocked) {
      pill.textContent = "On the adult list";
      pill.className = "site-pill neutral";
      meta.textContent = "Always blocked. It can't be trusted or skipped.";
    }
    const blockBtn = el("blockSiteCardBtn");
    if (blockBtn) blockBtn.textContent = userBlocked ? "Unblock" : "Block site";
  }

  el("blockSiteCardBtn")?.addEventListener("click", async () => {
    if (!currentDomain) return;
    const { blockedSites } = await storageGet(["blockedSites"]);
    if (isUserBlocked(blockedSites, currentDomain)) {
      if (!(await gate({ title: "Unblock this site?", detail: `${currentDomain} is on your own blocklist. Unblocking it means it is only checked like any other site.` }))) return;
      await removeBlockedSite(currentDomain);
    } else await addBlockedSite(currentDomain);
    await loadSiteCard();
    if (currentTabId) chrome.tabs.reload(currentTabId);
  });

  el("trustBtn")?.addEventListener("click", async () => {
    if (!currentDomain) return;
    const { trustedSites } = await storageGet(["trustedSites"]);
    if (isTrusted(trustedSites, currentDomain)) await removeTrustedSite(currentDomain);
    else {
      if (!(await gateTrust(currentDomain))) return;
      await addTrustedSite(currentDomain, "manual");
    }
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
      const ms = parseInt(btn.dataset.ms, 10);
      const domain = currentDomain;
      if (!(await gate({ title: "Skip this site?", detail: `${domain} won't be checked for ${btn.textContent.trim()}. That counts as protection being off today, so today won't be a protected day.` }))) return;
      await pauseSite(domain, ms);
      await recordDayEvent("pauses");
      el("pauseOpts").style.display = "none";
      await loadSiteCard();
      if (currentTabId) chrome.tabs.reload(currentTabId);
    });
  });

  // ── Ring: protected days out of the last 14 ────────────────────────────────
  //
  // The ring, the plant, the heatmap and the pause-page nudges all read the same thing
  // (shared/protection.js). A slip lowers the count by one and it recovers as the days
  // pass; nothing resets to zero.
  const CIRC = 376.99; // 2π × r=60

  const TODAY_LINES = {
    protected: "Today is protected. Nice.",
    passed: "Today is a slip: you opened a flagged page. One day isn't the pattern.",
    paused: "Today is a slip: protection was off for a while. One day isn't the pattern.",
  };

  async function updateRingDisplay() {
    const { today = {}, history = {}, totals = {}, enabled, disableUntil } =
      await storageGet(["today", "history", "totals", "enabled", "disableUntil"]);

    const todayKey = todayLocal();
    const win = protectionWindow(history, today, todayKey);
    const state = dayState(today);
    const browsed = today.browsedMinutes || 0;
    const anyActive = win.protected + win.passed + win.paused > 0;

    const fill = el("ringFill");
    const pctEl = el("ringPct");
    const sub = el("ringSub");
    const ctx = el("ringContext");

    if (fill) {
      fill.setAttribute("stroke-dasharray", `${(win.protected / win.days) * CIRC} ${CIRC}`);
      // A round line cap draws a dot even at zero length, which read as progress.
      fill.style.visibility = win.protected ? "" : "hidden";
    }

    // The plant (Progress tab) is the ring in another shape, and says so in words.
    const plant = el("plant");
    if (plant) {
      const stage = plantStage(win.protected);
      plant.dataset.stage = stage;
      el("plantName").textContent = { sprout: "A sprout", leafy: "Growing leaves", bloom: "In bloom" }[stage];
      el("plantText").textContent = stage === "bloom"
        ? `${win.protected} of the last ${win.days} days protected. It stays in bloom from ${PROTECTED_BLOOM_AT}.`
        : stage === "leafy"
          ? `${win.protected} of the last ${win.days} days protected. It blooms at ${PROTECTED_BLOOM_AT}.`
          : `It grows with your protected days: leaves at ${PROTECTED_LEAFY_AT} of the last ${win.days}, flowers at ${PROTECTED_BLOOM_AT}.`;
    }

    if (!anyActive) {
      // Zero of fourteen on day one would read as failure before anything has happened.
      if (pctEl) pctEl.textContent = "—";
      if (sub) sub.textContent = "your first days";
    } else {
      if (pctEl) pctEl.textContent = String(win.protected);
      if (sub) sub.textContent = `of last ${win.days} days`;
    }
    if (ctx) {
      ctx.textContent = TODAY_LINES[state] || (browsed
        ? `Today counts once you've browsed about ${PROTECTED_MIN_BROWSED} minutes. ${browsed} so far.`
        : "Nothing browsed yet today.");
    }
    // The mascot reads the same facts as the ring: asleep when protection is off, happy on
    // a protected day, a fresh sprout on day one, otherwise just keeping watch.
    const off = enabled === false || (disableUntil && disableUntil > Date.now());
    const mood = mascotMood({
      off: Boolean(off),
      state,
      protectedCount: win.protected,
      anyActive,
      milestoneToday: state === "protected" && MILESTONES.includes(lifetimeProtected(totals, today)),
    });
    setMood(mood);

    const sticker = el("ringSticker");
    if (sticker) sticker.style.display = state === "protected" ? "" : "none";

    el("todayRedirects").textContent = today.redirects ?? 0;
    el("closedDays").textContent = lifetimeProtected(totals, today);
    el("reflectionsTotal").textContent = totals.reflectionsLogged ?? 0;

    renderSlipCard(off ? "off" : state, win);
    celebrateIfProtected(state, today);
  }

  // Swap the pose with a small spring pop; the level class drives the idle animation
  // (sparkles, bounce) in theme.css, and the label tells assistive tech the mood.
  let currentMood = null;
  async function setMood(mood) {
    const host = el("mascotRing");
    if (!host) return;
    el("mascotSay").textContent = mood.caption;
    host.setAttribute("aria-label", `CleanTab mascot, ${mood.label}`);
    if (currentMood === mood.level) return;
    const first = currentMood === null;
    currentMood = mood.level;
    host.className = `mascot mascot-hero mood-${mood.level}`;
    await mountMascot(host, mood.pose);
    if (!first) {
      host.classList.remove("pop");
      void host.offsetWidth;
      host.classList.add("pop");
    }
  }

  // After a pass-through or a pause: one calm line, no counts of failures, no red.
  function renderSlipCard(state, win) {
    const box = el("slipCard");
    if (!box) return;
    if (state !== "passed" && state !== "paused") {
      box.style.display = "none";
      const ctxLine = el("ringContext");
      if (ctxLine) ctxLine.style.display = "";
      return;
    }
    mountMascot(el("mascotSlip"), "encourage");
    el("slipText").textContent =
      (win.protected ? `Still ${win.protected} of the last ${win.days} days protected. ` : "One day isn't the pattern. ") +
      "Want a plan for tonight? You can write one at your next pause.";
    const ctxLine = el("ringContext");
    if (ctxLine) ctxLine.style.display = "none";
    box.style.display = "";
  }

  // ── Celebration ────────────────────────────────────────────────────────────
  // Once per protected day. Confetti is decoration only; reduced-motion hides it (theme.css).
  const CONFETTI_COLORS = ["#FF6B35", "#F9D776", "#A9C8A0", "#A9CFE0", "#F7C9C4", "#CFC3EA"];

  function showToast(text, withConfetti) {
    const toast = el("toast");
    if (!toast) return;
    el("toastText").textContent = text;
    const box = el("confetti");
    box.innerHTML = "";
    if (withConfetti) {
      for (let i = 0; i < 18; i++) {
        const piece = document.createElement("i");
        piece.style.left = `${Math.random() * 100}%`;
        piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
        piece.style.animationDelay = `${Math.random() * 0.3}s`;
        box.appendChild(piece);
      }
    }
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, 3800);
  }

  async function celebrateIfProtected(state, today) {
    if (state !== "protected" || today.celebrated) return;
    // Mark first so a second render cannot celebrate twice.
    const fresh = (await storageGet(["today"])).today || today;
    if (fresh.celebrated) return;
    await storageSet({ today: { ...fresh, celebrated: true } });
    showToast("Protected day. Nice work.", true);
  }

  // ── Welcome back (no guilt) ────────────────────────────────────────────────
  async function renderWelcomeBack() {
    const { lastPopupOpen } = await storageGet(["lastPopupOpen"]);
    const box = el("welcomeBack");
    if (box && lastPopupOpen && Date.now() - lastPopupOpen > 14 * 24 * 60 * 60 * 1000) {
      el("welcomeText").textContent = "Welcome back. There's nothing to catch up on. Today is a fresh page.";
      box.style.display = "";
    }
    await storageSet({ lastPopupOpen: Date.now() });
  }

  // ── Inline insight ─────────────────────────────────────────────────────────
  const CHIPS = { bored:"Bored", stressed:"Stressed", habit:"Habit", avoiding:"Avoiding", lonely:"Lonely", tired:"Tired", curious:"Curious", unsure:"Not sure" };

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

    const { blockedSites = [] } = await storageGet(["blockedSites"]);
    const ubList = el("userBlockedList");
    ubList.innerHTML = "";
    if (!blockedSites.length) {
      const empty = document.createElement("p");
      empty.className = "empty-note";
      empty.textContent = "Nothing blocked by you yet.";
      ubList.appendChild(empty);
    }
    blockedSites.forEach((entry) => {
      const domain = blockedEntryDomain(entry);
      const row = document.createElement("div");
      row.className = "site-row";
      const info = document.createElement("div");
      info.className = "site-row-info";
      const name = document.createElement("span");
      name.className = "site-row-domain";
      name.textContent = domain;
      const sub = document.createElement("span");
      sub.className = "site-row-sub";
      sub.textContent = entry.addedAt ? `added ${relTime(entry.addedAt)}` : "added by you";
      info.append(name, sub);
      const remove = document.createElement("button");
      remove.className = "row-btn";
      remove.textContent = "Remove";
      remove.addEventListener("click", async () => {
        if (!(await gate({ title: "Unblock this site?", detail: `${domain} is on your own blocklist. Removing it means it is only checked like any other site.` }))) return;
        await removeBlockedSite(domain);
        loadSites();
      });
      row.append(info, remove);
      ubList.appendChild(row);
    });

    const blockList = el("blockList");
    blockList.innerHTML = "";
    if (!blocks.length) {
      const empty = document.createElement("p");
      empty.className = "empty-note";
      empty.textContent = "Nothing blocked yet.";
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
        if (!(await gateTrust(b.domain))) return;
        await addTrustedSite(b.domain, "manual");
        loadSites();
      });

      // Nothing on the adult list can be trusted, so the button is not offered.
      if (isKnownAdultDomain(b.domain)) row.append(info);
      else row.append(info, trust);
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
    if (isKnownAdultDomain(domain)) {
      input.value = "";
      input.placeholder = "That site is on the adult list";
      return;
    }
    if (!(await gateTrust(domain))) return;
    await addTrustedSite(domain, "manual");
    input.value = "";
    loadSites();
  });

  el("blockSiteBtn")?.addEventListener("click", async () => {
    const input = el("blockSiteInput");
    const raw = input.value.trim();
    if (!raw) return;
    const domain = raw.includes("://") ? domainFromUrl(raw) : normalizeDomain(raw);
    if (!domain || !domain.includes(".")) {
      input.value = "";
      input.placeholder = "Enter a domain like example.com";
      return;
    }
    await addBlockedSite(domain);
    input.value = "";
    loadSites();
  });
  el("blockSiteInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") el("blockSiteBtn").click();
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
        if (key === sensitivity) return;
        if (sensitivityLoosens(sensitivity, key) &&
            !(await gate({ title: `Switch to ${profile.label}?`, detail: "That is a looser setting: CleanTab will need more before it blocks a page." }))) return;
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
    const box = e.target;
    if (!box.checked) {
      box.checked = true; // stays on unless the wait is sat through
      if (!(await gate({ title: "Stop checking pictures?", detail: "Pages that are explicit only in their pictures would no longer be caught." }))) return;
      box.checked = false;
    }
    await storageSet({ enableDwellDetection: box.checked });
  });

  // ── Init ───────────────────────────────────────────────────────────────────

  mountMascot(el("mascotLocked"), "default");
  mountMascot(el("mascotPartner"), "default");

  (async () => {
    // The popup is where the numbers are read, so make sure they belong to today.
    await handleDailyRollover();
    await syncHeaderBadge();
    await loadSiteCard();
    await renderWelcomeBack();
    await updateRingDisplay();
    await renderGaps();
    await updateInlineInsight();
    await renderSensitivity();
    await renderLockStrength();
    renderNano();
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
    if (changes.today || changes.totals || changes.history || changes.enabled || changes.disableUntil) updateRingDisplay();
    if (changes.blockedSites) { loadSiteCard(); loadSites(); }
    if (changes.history || changes.reflections || changes.today) loadProgress();
    if (changes.reflections) updateInlineInsight();
    if (changes.trustedSites) { loadSiteCard(); loadSites(); }
    if (changes.enabled || changes.disableUntil) { syncHeaderBadge(); loadSiteCard(); }
    // Protection came back on from somewhere else (starting focus ends a pause).
    if (changes.enabled && changes.enabled.newValue === true) {
      if (disableTimerInterval) clearInterval(disableTimerInterval);
      el("ringCard").style.display = "";
      el("disableTimerCard").style.display = "none";
    }
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

  // Focus is an extra layer over protection, so protection cannot be paused or switched
  // off until focus is over. Returns true (and says so) when that is the case.
  async function blockedByFocus() {
    const status = focusStatus(await storageGet(["focus", "focusSession", "focusSkipUntil"]));
    if (!status.active) return false;
    el("lockedTitle").textContent = "You're focusing";
    el("lockedDetail").textContent =
      `Protection stays on until focus ends at ${focusClockText(status.until)}. End focus first, from the Focus tab.`;
    showView("view-locked");
    return true;
  }

  async function handleDisableFlow() {
    const data = await storageGet([
      "enabled", "cooldownUntil", "partnerLockHash", "partnerLockLabel", "lockWindow",
    ]);
    if (data.enabled === false) { showView("view-normal"); return; }
    if (await blockedByFocus()) return;

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
  el("cancelPartner")?.addEventListener("click", () => {
    partnerRemovalPending = false;
    if (partnerGate) { const done = partnerGate; partnerGate = null; done(false); }
    showView("view-normal");
  });

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
    if (partnerGate) {
      const done = partnerGate;
      partnerGate = null;
      showView("view-normal");
      done(true);
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

  // ── The gate: nothing gets looser on a click ───────────────────────────────
  //
  // Every change that weakens protection (trusting or skipping a site, unblocking, a
  // looser sensitivity, switching a check off, loosening the lock, re-running setup,
  // restoring a backup) goes through here. In order: an administrator's policy and the
  // user's own locked hours can refuse it outright; a partner's passphrase is asked for
  // if one exists; otherwise there is a 30-second wait. Tightening never comes here.
  // Resolves true only when the change may go ahead.

  let partnerGate = null;
  let loosenTimer = null;

  async function gate({ title, detail, managedKey }) {
    const data = await storageGet(["partnerLockHash", "partnerLockLabel", "lockWindow"]);
    const managed = await loadManaged();

    const refuse = (heading, text) => {
      el("lockedTitle").textContent = heading;
      el("lockedDetail").textContent = text;
      showView("view-locked");
      return false;
    };
    if (managedKey && managed[managedKey] === false) {
      return refuse("Locked by your administrator", "Your administrator has locked this setting.");
    }
    const permission = disablePermission(data, managed);
    if (!permission.allowed) {
      return refuse(
        permission.reason === "managed" ? "Locked by your administrator" : "Outside your unlock hours",
        permission.reason === "managed"
          ? permission.detail
          : `You set locked hours for ${describeLockWindow(data.lockWindow)}. Nothing can be loosened until they end.`,
      );
    }

    if (data.partnerLockHash) {
      el("partnerPrompt").textContent = `${title} ${permission.detail}`;
      el("partnerInput").value = "";
      el("partnerError").style.display = "none";
      el("partnerContinue").disabled = true;
      el("partnerContinue").classList.add("disabled");
      showView("view-partner");
      return new Promise((resolve) => { partnerGate = resolve; });
    }

    el("loosenTitle").textContent = title;
    el("loosenDetail").textContent = detail;
    const confirm = el("loosenConfirm");
    let left = LOOSEN_WAIT_S;
    confirm.disabled = true;
    confirm.classList.add("disabled");
    confirm.textContent = `Breathe… ${left}`;
    showView("view-loosen");

    return new Promise((resolve) => {
      const finish = (ok) => {
        clearInterval(loosenTimer);
        confirm.onclick = null;
        el("loosenCancel").onclick = null;
        showView("view-normal");
        resolve(ok);
      };
      clearInterval(loosenTimer);
      loosenTimer = setInterval(() => {
        left -= 1;
        if (left > 0) { confirm.textContent = `Breathe… ${left}`; return; }
        clearInterval(loosenTimer);
        confirm.disabled = false;
        confirm.classList.remove("disabled");
        confirm.textContent = "Go ahead";
      }, 1000);
      confirm.onclick = () => { if (!confirm.disabled) finish(true); };
      el("loosenCancel").onclick = () => finish(false);
    });
  }

  function gateTrust(domain) {
    return gate({
      title: "Trust this site?",
      detail: `CleanTab will stop checking ${domain} entirely, until you remove it from the Sites tab.`,
      managedKey: "allowTrustSites",
    });
  }

  // ── Gaps in coverage ───────────────────────────────────────────────────────
  // An incognito window the extension is not allowed into is a door left open. Say so
  // on the first screen, with the way to close it.
  async function renderGaps() {
    const row = el("gapRow");
    if (!row) return;
    const allowed = await new Promise((resolve) => {
      try { chrome.extension.isAllowedIncognitoAccess((ok) => resolve(Boolean(ok))); }
      catch { resolve(true); }
    });
    row.style.display = allowed ? "none" : "";
    el("gapText").textContent = "Incognito windows aren't covered yet";
  }
  el("gapRow")?.addEventListener("click", () => {
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
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
      if (await blockedByFocus()) return;
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
      await recordDayEvent("offs");
      showView("view-normal");
      await syncHeaderBadge();
      startDisableTimer(until);
    });
  });


  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (res) => {
        void chrome.runtime.lastError;
        resolve(res);
      });
    });
  }

  // ── Gemini Nano second opinion ─────────────────────────────────────────────
  //
  // Most machines will not support it, so the control has to say what it found rather
  // than offering a switch that silently does nothing.

  async function renderNano() {
    const box = el("nanoToggle");
    const sub = el("nanoSub");
    if (!box || !sub) return;

    const { enableNanoAssist } = await storageGet(["enableNanoAssist"]);
    box.checked = enableNanoAssist === true;

    let status;
    try {
      status = await sendMessage({ action: "nanoStatus" });
    } catch {
      status = { availability: "unavailable" };
    }

    const state = status?.availability || "unavailable";
    if (state === "unavailable") {
      box.disabled = true;
      box.checked = false;
      sub.textContent =
        "Not available on this machine. Detection works exactly as before — this only ever adds a second opinion.";
      return;
    }

    box.disabled = false;
    sub.textContent = state === "available"
      ? "Ready. Used only on pages the rules are unsure about — it never overrides a clear block."
      : state === "downloading"
        ? "Chrome is downloading the model. It will start helping once that finishes."
        : "Chrome will download the model the first time this is used. It runs on your device; nothing is sent anywhere.";
  }

  el("nanoToggle")?.addEventListener("change", async (e) => {
    if (!e.target.checked) {
      e.target.checked = true;
      if (!(await gate({ title: "Turn off the second opinion?", detail: "It only ever adds blocks the rules missed, so turning it off can only let more through." }))) return;
      e.target.checked = false;
    }
    await storageSet({ enableNanoAssist: e.target.checked });
    await renderNano();
  });

  // ── Re-run setup ───────────────────────────────────────────────────────────
  //
  // Re-running setup writes the same keys onboarding writes, which includes the lock
  // settings. That makes it a way to CLEAR a partner passphrase — a child could simply
  // re-run setup and drop the lock their parent set. So it goes through the same gate
  // the off switch does.

  async function openOnboarding() {
    // Clear any stale draft so the flow starts at the beginning rather than resuming
    // into the middle of an older, abandoned run.
    await storageRemove("onboardingDraft");
    // The setup page only works for a few minutes after the gate was passed, so opening
    // its address directly is not a way round the lock.
    await sessionSet({ setupUnlockedUntil: Date.now() + 15 * 60 * 1000 });
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") });
    window.close();
  }

  el("rerunSetupBtn")?.addEventListener("click", async () => {
    if (!(await gate({ title: "Run setup again?", detail: "Setup can change sensitivity and the lock, so it goes through the same wait as loosening them." }))) return;
    openOnboarding();
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
    const rerunNote = el("rerunNote");
    if (rerunNote) {
      if (data.partnerLockHash) {
        rerunNote.style.display = "";
        rerunNote.textContent =
          `${data.partnerLockLabel || "Your partner"} will need to enter the passphrase first — otherwise re-running setup would be a way to clear it.`;
      } else {
        rerunNote.style.display = "none";
      }
    }

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
    if (!e.target.checked) {
      e.target.checked = true;
      if (!(await gate({ title: "Turn off locked hours?", detail: "The off switch, and every way of loosening CleanTab, would be available at any hour again." }))) return;
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
      if (lockWindow?.enabled &&
          !(await gate({ title: "Change your locked hours?", detail: "Moving the hours can open up a time you locked on purpose." }))) {
        await renderLockStrength();
        return;
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
  // Coloured by what happened (shared/protection.js dayState), not by a gradient: sage
  // protected, butter passed through, blush paused, sand quiet. A quiet day is an absence,
  // not a bad day.
  // Two kinds of slip are stored (a flagged page opened anyway; protection switched off),
  // but they mean the same thing to the person looking, so they are shown as one.
  const HEAT_COLORS = { protected: "#A9C8A0", passed: "#F7C9C4", paused: "#F7C9C4", quiet: "#F1E4CC" };
  const HEAT_WORDS = {
    protected: "protected",
    passed: "a slip, a flagged page was opened anyway",
    paused: "a slip, protection was off for a while",
    quiet: "not counted, too little browsing",
  };

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
    const counts = { protected: 0, passed: 0, paused: 0, quiet: 0 };

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

      const state = dayState(key === todayKey ? todayData : history[key]);
      counts[state] += 1;
      cell.style.background = HEAT_COLORS[state];
      cell.title = `${key}: ${HEAT_WORDS[state]}`;
      grid.appendChild(cell);
    }

    grid.setAttribute("role", "img");
    grid.setAttribute("aria-label", `Last 16 weeks: ${counts.protected} protected days, ` +
      `${counts.passed + counts.paused} slips, ${counts.quiet} not counted.`);
    const summary = el("heatSummary");
    if (summary) summary.textContent = grid.getAttribute("aria-label");
  }

  // ── Weekly recap, milestones ───────────────────────────────────────────────
  // Counts only. The copy button is the user's own way to share it with a partner; nothing
  // is sent anywhere by CleanTab.
  let recapText = "";

  function renderRecap(history, today, reflections, totals) {
    const list = el("recapList");
    if (!list) return;
    const r = weeklyRecap(history, today, todayLocal(), reflections);
    const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
    const lines = [
      `Protected ${r.protectedDays} of the last 7 days`,
      `${r.pauses} blocked, ${plural(r.reflections, "reflection")}`,
    ];
    if (r.topChip && CHIPS[r.topChip]) lines.push(`Most common feeling: ${CHIPS[r.topChip]}`);
    if (r.topHour !== null) {
      lines.push(`Blocks cluster around ${r.topHour}:00. A plan for that hour can help.`);
    }
    list.innerHTML = "";
    lines.forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      list.appendChild(li);
    });
    mountMascot(el("mascotRecap"), r.protectedDays >= 5 ? "happy" : "sprout");
    recapText = `CleanTab, this week: ${lines.join(". ")}.`;

    const lifetime = lifetimeProtected(totals, today);
    const reached = reachedMilestones(lifetime);
    const box = el("milestones");
    box.innerHTML = "";
    MILESTONES.forEach((n) => {
      const sticker = document.createElement("span");
      sticker.className = "milestone" + (reached.includes(n) ? " got" : "");
      sticker.textContent = `${n} days`;
      sticker.title = reached.includes(n)
        ? `${n} protected days: reached`
        : `${n} protected days: ${n - lifetime} to go`;
      box.appendChild(sticker);
    });
    const best = bestRun(history, today, todayLocal());
    el("bestRunText").textContent = best
      ? `Your longest run of protected days: ${best}. It's a record, not a score to defend.`
      : "Protected days add up here. Nothing ever resets.";
  }

  el("recapCopy")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(recapText);
      el("recapCopy").textContent = "Copied";
    } catch {
      el("recapCopy").textContent = "Couldn't copy";
    }
    setTimeout(() => { el("recapCopy").textContent = "Copy summary"; }, 2000);
  });

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
    const { history = {}, today = {}, reflections = [], totals = {} } =
      await storageGet(["history", "today", "reflections", "totals"]);
    renderHeatmap(history, today);
    renderRecap(history, today, reflections, totals);
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

  // A backup can carry a looser sensitivity, a trust list or an empty blocklist.
  el("importBtn")?.addEventListener("click", async () => {
    if (!(await gate({ title: "Restore a backup?", detail: "A backup replaces your sensitivity, trusted sites and blocklist with whatever is in the file." }))) return;
    el("importFile")?.click();
  });

  // Only keys the schema defines are written. The old version handed whatever JSON it was
  // given straight to storage after checking a single truthy field.
  // Protection and lock state is never restored from a file: an import that could clear
  // the partner passphrase, the lock window or the off switch would be a way round them.
  const NOT_IMPORTABLE = new Set([
    "enabled", "disableUntil", "cooldownUntil", "partnerLockHash", "partnerLockLabel",
    "lockWindow", "disableEvents", "allowanceEvents",
    // A running focus session is state, not a setting; a file must not be able to end it.
    "focusSession", "focusSkipUntil",
  ]);
  const IMPORTABLE = new Set(
    Object.keys(getDefaults(todayLocal())).concat(["firstRedirectSeen"])
      .filter((k) => !NOT_IMPORTABLE.has(k)),
  );

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
