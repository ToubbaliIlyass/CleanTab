document.addEventListener("DOMContentLoaded", async () => {
  // The blocked URL no longer travels in the query string — it lived in the omnibox,
  // in history and in session restore. The worker hands it over by tab id instead.
  const ctx = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "getBlockContext" }, (res) => {
      resolve(chrome.runtime.lastError || !res
        ? { reason: "This page was flagged.", domain: "", canAppeal: false }
        : res);
    });
  });

  const domain = ctx.domain || "";

  const reasonEl = document.getElementById("reason-text");
  if (reasonEl && ctx.reason) reasonEl.textContent = ctx.reason;

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

  function buildNudge(chipKey, today, totals, goalMinutes) {
    const cleanMins = today.cleanMinutes || 0;
    const redirects = today.redirects || 1;
    const closedDays = totals.closedDays || 0;
    const remaining = Math.max(0, goalMinutes - cleanMins);
    const pct = Math.min(100, Math.round((cleanMins / goalMinutes) * 100));
    const hour = new Date().getHours();

    switch (chipKey) {
      case "bored":
        if (cleanMins >= goalMinutes)
          return { text: "Your ring is closed for today. The work is done." };
        return { text: `Your ring is at ${pct}% — ${remaining} min to close today.` };

      case "stressed":
        return { text: "Take a moment to breathe. It takes less than a minute.", breathe: true };

      case "habit":
        if (redirects <= 1) return { text: "First pause today." };
        return { text: `This is your ${ordinal(redirects)} pause today.` };

      case "avoiding":
        if (closedDays === 0)
          return { text: "Today is day one. The first ring is the hardest." };
        if (cleanMins < goalMinutes)
          return { text: `You've closed your ring on ${closedDays} day${closedDays === 1 ? "" : "s"}. Today's still open.` };
        return { text: `You've closed your ring on ${closedDays} day${closedDays === 1 ? "" : "s"}. Today makes ${closedDays + 1}.` };

      case "lonely":
        return { text: "Loneliness often fuels the scroll. A quick message to someone real lands deeper." };

      case "tired":
        if (hour >= 21 || hour < 4)
          return { text: "It's getting late — your body's tired. Worth closing the laptop?" };
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

      const before = await storageGet(["today", "goalMinutes"]);
      const total = await recordReflection(chip.dataset.chip, domain);
      const after = await storageGet(["totals"]);

      if (loggedEl) loggedEl.style.display = "flex";
      if (loggedText) loggedText.textContent = `Logged. ${total} total.`;

      const nudge = buildNudge(
        chip.dataset.chip,
        before.today || {},
        after.totals || {},
        before.goalMinutes || 120,
      );
      if (nudge && nudgeCard && nudgeText) {
        nudgeText.textContent = nudge.text;
        if (nudgeBreathe) nudgeBreathe.style.display = nudge.breathe ? "" : "none";
        nudgeCard.style.display = "";
      }
    });
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

  // ── Escape hatches ───────────────────────────────────────────────────────
  //
  // Two outcomes instead of one. A one-off false positive is the common case and should
  // cost one click and leave no permanent state; trusting a whole domain is a real
  // decision and gets a real check. The old single "appeal" button did the second thing
  // while looking like the first, and its check was reading the wrong page.

  const wrongBtn = document.getElementById("wrongBtn");
  const escapeBox = document.getElementById("escapeBox");
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

  // Three uses per site per day. Said up front rather than discovered on the fourth
  // press — a limit you meet by surprise reads as the tool breaking.
  function paintAllowance() {
    if (!allowOnceBtn || !allowOnceSub) return;
    const remaining = ctx.allowanceRemaining;
    if (typeof remaining !== "number") return;

    if (remaining <= 0) {
      allowOnceBtn.disabled = true;
      allowOnceSub.textContent = ctx.allowanceMessage ||
        "Used three times on this site today.";
      return;
    }
    allowOnceSub.textContent =
      `This page only, 10 minutes. Nothing saved. ${ctx.allowanceMessage || ""}`.trim();
  }

  wrongBtn?.addEventListener("click", () => {
    if (!escapeBox) return;
    escapeBox.style.display = escapeBox.style.display === "none" ? "flex" : "none";
    paintAllowance();
    if (!ctx.canAppeal && trustSiteBtn) {
      trustSiteBtn.disabled = true;
      if (trustSiteSub) trustSiteSub.textContent = "This domain is on the adult content blocklist.";
    } else if (trustSiteSub && domain) {
      trustSiteSub.textContent = `Check ${domain}'s images and trust it from now on.`;
    }
  });

  allowOnceBtn?.addEventListener("click", () => {
    allowOnceBtn.disabled = true;
    setStatus("Opening for 10 minutes…", "ok");
    chrome.runtime.sendMessage({ action: "allowOnce" }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) {
        if (res?.exhausted) {
          // Not an error — a limit. Point at the path that actually fits a page that
          // really was flagged wrongly.
          setStatus(res.reason, "");
          allowOnceSub.textContent = res.reason;
          return; // stays disabled
        }
        setStatus("Couldn't reopen the page — it may have been lost.", "err");
        allowOnceBtn.disabled = false;
      }
    });
  });

  trustSiteBtn?.addEventListener("click", () => {
    trustSiteBtn.disabled = true;
    setStatus("Checking this page's images…", "");

    chrome.runtime.sendMessage({ action: "appealRequest" }, (res) => {
      if (chrome.runtime.lastError || !res) {
        setStatus("Could not reach the extension. Try reloading.", "err");
        trustSiteBtn.disabled = false;
        return;
      }

      if (res.status === "approved") {
        setStatus(res.reason, "ok");
        return; // the worker is navigating this tab back
      }

      // Both "denied" and "inconclusive" keep the block. Inconclusive says so plainly
      // rather than clearing the page by default — the old flow's failure mode.
      setStatus(res.reason, res.status === "inconclusive" ? "" : "err");
      if (!res.permanent) {
        setTimeout(() => { trustSiteBtn.disabled = false; }, 8000);
      }
    });
  });
});
