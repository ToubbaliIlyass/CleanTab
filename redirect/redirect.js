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

  // ── Reflection chips ─────────────────────────────────────────────────────
  const chipsEl = document.getElementById("chips");
  const loggedEl = document.getElementById("chipLogged");
  const loggedText = document.getElementById("loggedText");
  let logged = false;

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      if (logged) return;
      logged = true;

      chip.classList.add("selected");
      chipsEl.style.pointerEvents = "none";
      chipsEl.style.opacity = "0.45";

      chrome.storage.local.get(["today", "totals", "reflections"], (data) => {
        const today = { ...(data.today || {}) };
        today.reflections = (today.reflections || 0) + 1;

        const totals = { ...(data.totals || {}) };
        totals.reflectionsLogged = (totals.reflectionsLogged || 0) + 1;

        const reflections = [...(data.reflections || [])];
        reflections.push({ ts: Date.now(), chip: chip.dataset.chip, domain });
        while (reflections.length > 1000) reflections.shift();

        chrome.storage.local.set({ today, totals, reflections }, () => {
          if (loggedEl) loggedEl.style.display = "flex";
          if (loggedText) {
            loggedText.textContent = `Logged. ${totals.reflectionsLogged} total.`;
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
