document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const reason = params.get("reason");
  const originalUrl = params.get("original");
  const domain = (() => { try { return new URL(originalUrl).hostname; } catch { return ""; } })();

  // ── Reason text ───────────────────────────────────────────────────────────
  const reasonEl = document.getElementById("reason-text");
  if (reasonEl && reason) reasonEl.textContent = reason;

  // ── First-time note ───────────────────────────────────────────────────────
  chrome.storage.local.get(["firstRedirectSeen"], ({ firstRedirectSeen }) => {
    if (!firstRedirectSeen) {
      const note = document.getElementById("firstTimeNote");
      if (note) note.style.display = "block";
      chrome.storage.local.set({ firstRedirectSeen: true });
    }
  });

  // ── Reflection chips ──────────────────────────────────────────────────────
  const chipsEl = document.getElementById("chips");
  const confirmEl = document.getElementById("chipConfirm");
  const confirmText = document.getElementById("confirmText");
  const confirmCount = document.getElementById("confirmCount");

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      if (confirmEl.style.display !== "none") return; // already logged

      chip.classList.add("selected");

      const chipName = chip.dataset.chip;

      // Write to storage
      chrome.storage.local.get(["today", "totals", "reflections"], (data) => {
        const today = { ...(data.today || {}) };
        today.reflections = (today.reflections || 0) + 1;

        const totals = { ...(data.totals || {}) };
        totals.reflectionsLogged = (totals.reflectionsLogged || 0) + 1;

        const reflections = [...(data.reflections || [])];
        reflections.push({ ts: Date.now(), chip: chipName, domain });
        while (reflections.length > 1000) reflections.shift();

        chrome.storage.local.set({ today, totals, reflections }, () => {
          // Show confirmation
          chipsEl.style.pointerEvents = "none";
          chipsEl.style.opacity = "0.5";
          confirmEl.style.display = "block";
          confirmText.textContent = "Logged.";
          if (totals.reflectionsLogged > 1) {
            confirmCount.textContent = `${totals.reflectionsLogged - 1} → ${totals.reflectionsLogged} reflections`;
          }
        });
      });
    });
  });

  // ── Take a beat (breathing animation) ─────────────────────────────────────
  const overlay = document.getElementById("breathingOverlay");
  const circle = document.getElementById("breathingCircle");
  const label = document.getElementById("breathingLabel");
  const skipBtn = document.getElementById("breathingSkip");
  const breatheBtn = document.getElementById("breatheBtn");

  const PHASES = [
    { cls: "inhale", text: "Breathe in",  ms: 4000 },
    { cls: "hold",   text: "Hold",         ms: 4000 },
    { cls: "exhale", text: "Breathe out",  ms: 4000 },
  ];
  const CYCLES = 3;

  function runBreathing() {
    overlay.classList.add("active");
    let cycle = 0;
    let phaseIdx = 0;

    function nextPhase() {
      if (!overlay.classList.contains("active")) return;

      const { cls, text, ms } = PHASES[phaseIdx];
      circle.className = "breathing-circle " + cls;
      label.textContent = text;

      phaseIdx++;
      if (phaseIdx >= PHASES.length) {
        phaseIdx = 0;
        cycle++;
        if (cycle >= CYCLES) {
          setTimeout(() => overlay.classList.remove("active"), ms);
          return;
        }
      }

      setTimeout(nextPhase, ms);
    }

    nextPhase();
  }

  if (breatheBtn) breatheBtn.addEventListener("click", runBreathing);
  if (skipBtn) skipBtn.addEventListener("click", () => overlay.classList.remove("active"));

  // ── Appeal ─────────────────────────────────────────────────────────────────
  const appealBtn = document.getElementById("appeal-btn");
  const appealStatus = document.getElementById("appeal-status");

  if (appealBtn) {
    appealBtn.addEventListener("click", () => {
      appealBtn.disabled = true;
      appealBtn.textContent = "Checking…";
      if (appealStatus) {
        appealStatus.className = "appeal-status";
        appealStatus.textContent = "";
      }

      chrome.runtime.sendMessage({ action: "appealRequest" }, (response) => {
        if (!response) {
          appealStatus.className = "appeal-status error";
          appealStatus.textContent = "Could not reach the extension. Try reloading the page.";
          appealBtn.disabled = false;
          appealBtn.textContent = "This was wrongly flagged";
          return;
        }

        if (response.status === "approved") {
          appealStatus.className = "appeal-status approved";
          appealStatus.textContent = response.reason || "Approved — taking you back.";
          appealBtn.textContent = "Approved";

          setTimeout(() => {
            window.location.href = response.originalUrl || originalUrl || "/";
          }, 1500);
        } else {
          appealStatus.className = "appeal-status denied";
          appealStatus.textContent = response.reason || "This page remains blocked.";
          setTimeout(() => {
            appealBtn.disabled = false;
            appealBtn.textContent = "This was wrongly flagged";
          }, 8000);
        }
      });
    });
  }
});
