document.addEventListener("DOMContentLoaded", async () => {
  // The blocked URL no longer travels in the query string — it lived in the omnibox,
  // in history and in session restore. The worker hands it over by tab id instead.
  // ?demo=1 is the "Try a pause" practice screen from onboarding: same page, nothing
  // flagged, nothing logged, no way around it to demonstrate.
  mountMascot(document.getElementById("mascotPause"), "default");
  mountMascot(document.getElementById("mascotBreath"), "sleepy");

  const demo = new URLSearchParams(location.search).get("demo") === "1";

  const ctx = demo ? { reason: "This is what a pause looks like.", domain: "", canAppeal: false } : await new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "getBlockContext" }, (res) => {
      resolve(chrome.runtime.lastError || !res
        ? { reason: "This page was flagged.", domain: "", canAppeal: false }
        : res);
    });
  });

  const domain = ctx.domain || "";

  const reasonEl = document.getElementById("reason-text");
  if (reasonEl && ctx.reason) reasonEl.textContent = ctx.reason;

  if (demo) {
    document.getElementById("demoNote").style.display = "";
    document.getElementById("wrongBtn").style.display = "none";
    document.getElementById("wrongSep").style.display = "none";
  }

  // ── Focus mode ───────────────────────────────────────────────────────────
  // Same page, different conversation. Nothing was flagged, so there is nothing to
  // reflect on and nothing to appeal: it says how long is left, and offers five minutes
  // if the site is genuinely needed.
  const focus = ctx.kind === "focus";
  let focusOver = false;

  if (focus) {
    document.title = "Focus · CleanTab";
    document.getElementById("pauseTitle").textContent = "Focus.";
    document.getElementById("reflectBox").style.display = "none";
    document.getElementById("reflectRule").style.display = "none";
    document.getElementById("leaveBtn").textContent = "Back to work";
    document.getElementById("wrongBtn").textContent = "I need this site";

    const left = document.getElementById("focusLeft");
    left.style.display = "";

    const paintFocus = () => {
      const remaining = (ctx.until || 0) - Date.now();
      if (ctx.stillBlocked && remaining > 0) {
        left.textContent = `${focusRemainingText(remaining)} left, until ${focusClockText(ctx.until)}.`;
        return false;
      }
      focusOver = true;
      left.textContent = "Focus is over. Nice work.";
      if (reasonEl) reasonEl.textContent = domain ? `${domain} is open again.` : "It's open again.";
      const once = document.getElementById("allowOnceBtn");
      document.getElementById("escapeBox").style.display = "flex";
      document.getElementById("anywayBox").style.display = "";
      document.getElementById("wrongBtn").style.display = "none";
      document.getElementById("wrongSep").style.display = "none";
      once.disabled = false;
      once.querySelector(".escape-title").textContent = domain ? `Open ${domain}` : "Open the site";
      document.getElementById("allowOnceSub").textContent = "Or close this tab and keep the momentum.";
      return true;
    };
    document.getElementById("trustSiteBtn").style.display = "none";
    document.getElementById("checkBtn").style.display = "none";
    if (!paintFocus()) {
      const timer = setInterval(() => { if (paintFocus()) clearInterval(timer); }, 15000);
    }
  }

  // ── First-redirect note ──────────────────────────────────────────────────
  chrome.storage.local.get(["firstRedirectSeen"], ({ firstRedirectSeen }) => {
    if (!firstRedirectSeen) {
      const note = document.getElementById("firstTimeNote");
      if (note) note.style.display = "block";
      chrome.storage.local.set({ firstRedirectSeen: true });
    }
  });

  // ── Contextual nudge ─────────────────────────────────────────────────────
  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // Nudges speak in terms of the same numbers the popup shows: days protected out of the
  // last 14. They never mention minutes to close, a streak or a count of failures.
  function buildNudge(chipKey, win, redirects) {
    const hour = new Date().getHours();

    switch (chipKey) {
      case "bored":
        return win.protected > 0
          ? { text: `You've protected ${win.protected} of the last ${win.days} days. This pause is part of that.` }
          : { text: "Boredom passes. A short walk or a glass of water is a good reset." };

      case "stressed":
        return { text: "Take a moment to breathe. It takes less than a minute.", breathe: true };

      case "habit":
        if (redirects <= 1) return { text: "First pause today. Noticing it is the work." };
        return { text: `Your ${ordinal(redirects)} pause today. Noticing it is the work.` };

      case "avoiding":
        return { text: "Whatever it is, it's usually smaller once you look at it. One small step on it?" };

      case "lonely":
        return { text: "Wanting connection is human. A message to someone real can go a long way." };

      case "curious":
        return { text: "Curiosity is normal. You don't owe this tab anything. It's fine to close it." };

      case "unsure":
        return { text: "No need to name it. A pause is enough." };

      case "tired":
        if (hour >= 21 || hour < 4)
          return { text: "It's getting late, and your body is tired. Worth closing the laptop?" };
        return { text: "Your body's giving a signal. Step away for 10 min." };

      default:
        return null;
    }
  }

  // ── Reflection chips ─────────────────────────────────────────────────────
  const chipsEl = document.getElementById("chips");
  const loggedEl = document.getElementById("chipLogged");
  const loggedText = document.getElementById("loggedText");
  const nudgeCard = document.getElementById("nudgeCard");
  const nudgeText = document.getElementById("nudgeText");
  const nudgeBreathe = document.getElementById("nudgeBreathe");
  let logged = false;

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", async () => {
      if (logged) return;
      logged = true;

      chip.classList.add("selected");
      chipsEl.style.pointerEvents = "none";
      chipsEl.style.opacity = "0.45";

      const chipKey = chip.dataset.chip;
      let total = 0;
      let nudge;

      if (demo) {
        nudge = buildNudge(chipKey, { protected: 0, days: PROTECTION_WINDOW_DAYS }, 1);
      } else {
        const before = await storageGet(["today", "history", "ifThenPlans"]);
        total = await recordReflection(chipKey, domain);
        const win = protectionWindow(before.history || {}, before.today || {}, todayLocal());
        nudge = buildNudge(chipKey, win, (before.today || {}).redirects || 1);
        // Their own plan, if they made one for this feeling, outranks any generic line.
        const plan = (before.ifThenPlans || {})[chipKey];
        if (plan) nudge = { text: `Your plan: ${plan}`, breathe: nudge?.breathe };
        else showPlanBox(chipKey);
      }

      if (loggedEl && !demo) loggedEl.style.display = "flex";
      if (loggedText && !demo) loggedText.textContent = `Logged. ${total} total.`;

      if (nudge && nudgeCard && nudgeText) {
        nudgeText.textContent = nudge.text;
        if (nudgeBreathe) nudgeBreathe.style.display = nudge.breathe ? "" : "none";
        nudgeCard.style.display = "";
      }
    });
  });

  // ── If-then plan ─────────────────────────────────────────────────────────
  // One optional line per feeling. It is shown back the next time that feeling lands here.
  const planBox = document.getElementById("planBox");
  const planInput = document.getElementById("planInput");
  let planChip = null;

  function showPlanBox(chipKey) {
    if (!planBox) return;
    planChip = chipKey;
    planBox.style.display = "";
  }

  document.getElementById("planSave")?.addEventListener("click", async () => {
    const text = (planInput?.value || "").trim().slice(0, 80);
    if (!text || !planChip) return;
    const { ifThenPlans } = await storageGet(["ifThenPlans"]);
    await storageSet({ ifThenPlans: { ...(ifThenPlans || {}), [planChip]: text } });
    planBox.style.display = "none";
    if (nudgeText) nudgeText.textContent = `Saved. Next time: ${text}`;
  });

  // ── Leave ────────────────────────────────────────────────────────────────
  document.getElementById("leaveBtn")?.addEventListener("click", () => {
    if (demo) {
      setStatus("That's all there is to it. You can close this tab.", "ok");
      return;
    }
    chrome.runtime.sendMessage({ action: "leavePause" }, () => { void chrome.runtime.lastError; });
  });

  // ── Breathing animation ──────────────────────────────────────────────────
  const overlay = document.getElementById("breathOverlay");
  const orb     = document.getElementById("breathOrb");
  const word    = document.getElementById("breathWord");
  const skip    = document.getElementById("breathSkip");
  const breatheBtn = document.getElementById("breatheBtn");

  const PHASES = [
    { cls: "inhale", text: "Breathe in",  ms: 4000 },
    { cls: "hold",   text: "Hold",        ms: 4000 },
    { cls: "exhale", text: "Breathe out", ms: 4000 },
  ];

  function runBreathing() {
    overlay.classList.add("active");
    let cycle = 0, phase = 0;

    function next() {
      if (!overlay.classList.contains("active")) return;
      const { cls, text, ms } = PHASES[phase];
      orb.className = "breath-orb " + cls;
      // The sleepy mascot breathes with the orb (same phase classes, see theme.css).
      document.getElementById("mascotBreath").className = "mascot mascot-breath " + cls;
      word.textContent = text;
      phase = (phase + 1) % PHASES.length;
      if (phase === 0) cycle++;
      if (cycle >= 3 && phase === 0) {
        setTimeout(() => overlay.classList.remove("active"), ms);
        return;
      }
      setTimeout(next, ms);
    }
    next();
  }

  breatheBtn?.addEventListener("click", runBreathing);
  nudgeBreathe?.addEventListener("click", runBreathing);
  skip?.addEventListener("click", () => overlay.classList.remove("active"));

  // ── A wrong block ────────────────────────────────────────────────────────
  //
  // "Check this page" re-reads the page (words and pictures) in the worker. Clean: it
  // opens, free. Not clean: it stays closed, and "Open it anyway" appears with what that
  // costs: a wait that doubles with each pass-through today, the partner's passphrase if
  // there is one, and nothing at all during locked hours. The worker enforces every part
  // of that; this page only shows it.

  const wrongBtn = document.getElementById("wrongBtn");
  const escapeBox = document.getElementById("escapeBox");
  const checkBtn = document.getElementById("checkBtn");
  const checkSub = document.getElementById("checkSub");
  const anywayBox = document.getElementById("anywayBox");
  const anywayText = document.getElementById("anywayText");
  const anywayPartner = document.getElementById("anywayPartner");
  const allowOnceBtn = document.getElementById("allowOnceBtn");
  const allowOnceSub = document.getElementById("allowOnceSub");
  const trustSiteBtn = document.getElementById("trustSiteBtn");
  const trustSiteSub = document.getElementById("trustSiteSub");
  const appealStatus = document.getElementById("appeal-status");

  function setStatus(text, kind) {
    if (!appealStatus) return;
    appealStatus.className = "appeal-result" + (kind ? ` ${kind}` : "");
    appealStatus.textContent = text;
  }

  // A site on the adult list or the reader's own blocklist has nothing to check.
  if (!focus && !demo && ctx.listed) {
    wrongBtn.style.display = "none";
    document.getElementById("wrongSep").style.display = "none";
    setStatus(ctx.listedNote || "", "");
  }

  function paintFocusPass() {
    const remaining = ctx.allowanceRemaining;
    anywayBox.style.display = "";
    anywayText.style.display = "none";
    if (focusOver) return;
    allowOnceBtn.querySelector(".escape-title").textContent = "Open it for 5 minutes";
    allowOnceBtn.disabled = !(remaining > 0);
    allowOnceSub.textContent = remaining > 0
      ? `This site only, then focus picks up again. ${remaining} of 3 left today.`
      : "That's three times on this site today. It will be here when you're done.";
  }

  wrongBtn?.addEventListener("click", () => {
    if (!escapeBox) return;
    escapeBox.style.display = escapeBox.style.display === "none" ? "flex" : "none";
    if (focus) { paintFocusPass(); return; }
    if (!ctx.canAppeal && trustSiteBtn) trustSiteBtn.style.display = "none";
    else if (trustSiteSub && domain) {
      trustSiteSub.textContent = `The same check. If it's clean, ${domain} is trusted from now on.`;
    }
  });

  let waitTimer = null;

  function showAnyway(anyway) {
    anywayBox.style.display = "";
    if (!anyway.available) {
      anywayText.textContent = anyway.why;
      allowOnceBtn.style.display = "none";
      return;
    }
    anywayText.textContent =
      "You can still open it. That makes today a slip instead of a protected day, and it waits first.";
    anywayPartner.style.display = anyway.needsPartner ? "" : "none";
    allowOnceBtn.style.display = "";
    allowOnceBtn.disabled = true;

    let left = anyway.waitSeconds;
    const paint = () => {
      allowOnceSub.textContent = left > 0
        ? `Breathe. ${left} second${left === 1 ? "" : "s"}. The wait doubles each time you do this today.`
        : "This page only, for 10 minutes.";
      allowOnceBtn.disabled = left > 0;
    };
    paint();
    if (waitTimer) clearInterval(waitTimer);
    waitTimer = setInterval(() => {
      left -= 1;
      paint();
      if (left <= 0) clearInterval(waitTimer);
    }, 1000);
  }

  checkBtn?.addEventListener("click", () => {
    checkBtn.disabled = true;
    setStatus("Checking the page's words and pictures…", "");
    chrome.runtime.sendMessage({ action: "checkPage" }, (res) => {
      if (chrome.runtime.lastError || !res) {
        setStatus("Could not reach the extension. Try reloading.", "err");
        checkBtn.disabled = false;
        return;
      }
      if (res.status === "clean") { setStatus(res.reason, "ok"); return; } // the worker reopens it
      setStatus(res.reason, res.status === "flagged" ? "err" : "");
      if (res.anyway) {
        checkSub.textContent = "Checked. It stays closed.";
        showAnyway(res.anyway);
      } else {
        checkBtn.disabled = false;
      }
    });
  });

  allowOnceBtn?.addEventListener("click", () => {
    allowOnceBtn.disabled = true;
    setStatus(focus ? (focusOver ? "Opening…" : "Opening for 5 minutes…") : "Opening for 10 minutes…", "ok");
    chrome.runtime.sendMessage({ action: "allowOnce", passphrase: anywayPartner?.value || "" }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) {
        setStatus(res?.reason || "Couldn't reopen the page. It may have been lost.", res?.exhausted ? "" : "err");
        if (res?.partner) { anywayPartner.value = ""; anywayPartner.focus(); }
        // A limit stays closed; anything else can be tried again.
        allowOnceBtn.disabled = Boolean(res?.exhausted);
      }
    });
  });
  // Recall, not copy: the same rule as every other passphrase in CleanTab.
  anywayPartner?.addEventListener("paste", (e) => e.preventDefault());

  trustSiteBtn?.addEventListener("click", () => {
    trustSiteBtn.disabled = true;
    setStatus("Checking the page's words and pictures…", "");

    chrome.runtime.sendMessage({ action: "appealRequest" }, (res) => {
      if (chrome.runtime.lastError || !res) {
        setStatus("Could not reach the extension. Try reloading.", "err");
        trustSiteBtn.disabled = false;
        return;
      }
      if (res.status === "approved") { setStatus(res.reason, "ok"); return; }
      // Both "denied" and "inconclusive" keep the block.
      setStatus(res.reason, res.status === "inconclusive" ? "" : "err");
      if (!res.permanent) setTimeout(() => { trustSiteBtn.disabled = false; }, 8000);
    });
  });
});
