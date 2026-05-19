document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const reason = params.get("reason");
  const originalUrl = params.get("original");
  const domain = (() => { try { return new URL(originalUrl).hostname; } catch { return ""; } })();

  // ── Reason text ─────────────────────────────────────────────────────────
  const reasonEl = document.getElementById("reason-text");
  if (reasonEl && reason) reasonEl.textContent = reason;

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
    chip.addEventListener("click", () => {
      if (logged) return;
      logged = true;

      chip.classList.add("selected");
      chipsEl.style.pointerEvents = "none";
      chipsEl.style.opacity = "0.45";

      chrome.storage.local.get(["today", "totals", "reflections", "goalMinutes"], (data) => {
        const rawToday = data.today || {};
        const today = { ...rawToday };
        today.reflections = (today.reflections || 0) + 1;

        const totals = { ...(data.totals || {}) };
        totals.reflectionsLogged = (totals.reflectionsLogged || 0) + 1;

        const reflections = [...(data.reflections || [])];
        reflections.push({ ts: Date.now(), chip: chip.dataset.chip, domain });
        while (reflections.length > 1000) reflections.shift();

        chrome.storage.local.set({ today, totals, reflections }, () => {
          if (loggedEl) loggedEl.style.display = "flex";
          if (loggedText) loggedText.textContent = `Logged. ${totals.reflectionsLogged} total.`;

          // Show contextual nudge
          const nudge = buildNudge(chip.dataset.chip, rawToday, totals, data.goalMinutes || 120);
          if (nudge && nudgeCard && nudgeText) {
            nudgeText.textContent = nudge.text;
            if (nudgeBreathe) nudgeBreathe.style.display = nudge.breathe ? "" : "none";
            nudgeCard.style.display = "";
          }
        });
      });
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
    { cls: "hold",   text: "Hold",         ms: 4000 },
    { cls: "exhale", text: "Breathe out",  ms: 4000 },
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

  // ── Appeal ───────────────────────────────────────────────────────────────
  const appealBtn = document.getElementById("appeal-btn");
  const appealStatus = document.getElementById("appeal-status");

  appealBtn?.addEventListener("click", () => {
    appealBtn.disabled = true;
    appealBtn.textContent = "Checking…";
    if (appealStatus) { appealStatus.className = "appeal-result"; appealStatus.textContent = ""; }

    chrome.runtime.sendMessage({ action: "appealRequest" }, (response) => {
      if (!response) {
        if (appealStatus) { appealStatus.className = "appeal-result err"; appealStatus.textContent = "Could not reach the extension. Try reloading."; }
        appealBtn.disabled = false; appealBtn.textContent = "This was wrongly flagged";
        return;
      }
      if (response.status === "approved") {
        if (appealStatus) { appealStatus.className = "appeal-result ok"; appealStatus.textContent = response.reason || "Approved — taking you back."; }
        appealBtn.textContent = "Approved";
        setTimeout(() => { window.location.href = response.originalUrl || originalUrl || "/"; }, 1500);
      } else {
        if (appealStatus) { appealStatus.className = "appeal-result"; appealStatus.textContent = response.reason || "This page remains blocked."; }
        setTimeout(() => { appealBtn.disabled = false; appealBtn.textContent = "This was wrongly flagged"; }, 8000);
      }
    });
  });
});
