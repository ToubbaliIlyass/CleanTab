document.addEventListener("DOMContentLoaded", () => {
  console.log("popup.js loaded");

  chrome.runtime.sendMessage({ action: "syncDaily" });

  // ---------- Helpers ----------
  function showView(viewClass) {
    document.querySelectorAll(".view").forEach((v) => {
      v.classList.remove("is-active");
    });

    const target = document.querySelector(`.${viewClass}`);
    if (target) {
      target.classList.add("is-active");
    } else {
      console.warn("View not found:", viewClass);
    }
  }

  function formatTime(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${h}h ${m}m ${s}s`;
  }

  function attachPassphraseGuards(viewSelector) {
    const input = document.querySelector(`${viewSelector} .text-input`);
    if (!input) return;

    input.addEventListener("paste", (e) => e.preventDefault());
    input.addEventListener("drop", (e) => e.preventDefault());
  }

  function syncEnabledUI(enabled) {
    const badge = document.getElementById("statusBadge");
    const disableBtn = document.getElementById("disableBtn");
    const enableBtn = document.getElementById("enableBtn");

    if (!badge || !disableBtn || !enableBtn) return;

    if (enabled) {
      badge.innerHTML =
        '<span class="status-dot"></span><span class="status-text">Active</span>';
      badge.classList.add("on");
      badge.classList.remove("off");

      disableBtn.style.display = "flex";
      enableBtn.style.display = "none";
    } else {
      badge.innerHTML =
        '<span class="status-dot"></span><span class="status-text">Inactive</span>';
      badge.classList.remove("on");
      badge.classList.add("off");

      disableBtn.style.display = "none";
      enableBtn.style.display = "flex";
    }
  }

  attachPassphraseGuards(".view-passphrase");
  attachPassphraseGuards(".view-reenter");

  // ---------- Resume cooldown on popup open ----------
  chrome.storage.local.get(
    ["enabled", "cooldownUntil"],
    ({ enabled, cooldownUntil }) => {
      // If extension is disabled, ignore cooldown completely
      if (enabled === false) return;

      if (!cooldownUntil) return;

      if (cooldownUntil > Date.now()) {
        console.log("Resuming active cooldown");
        showView("view-cooldown");
        startCooldownTimer(cooldownUntil);
      } else {
        console.log("Cooldown expired, requiring re-entry");
        showView("view-reenter");
      }
    },
  );

  chrome.storage.local.get("enabled", ({ enabled }) => {
    if (enabled === false) {
      syncEnabledUI(false);
    } else {
      syncEnabledUI(true);
    }
  });

  // ---------- Helper: Disable button flow for cooldown ----------
  function handleDisableFlow() {
    chrome.storage.local.get(
      ["enabled", "cooldownUntil"],
      ({ enabled, cooldownUntil }) => {
        // If CleanTab is already disabled, never enter disable flow
        if (enabled === false) {
          showView("view-normal");
          return;
        }

        // No cooldown → normal confirmation
        if (!cooldownUntil) {
          showView("view-confirm");
          return;
        }

        // Cooldown active
        if (cooldownUntil > Date.now()) {
          showView("view-cooldown");
          startCooldownTimer(cooldownUntil);
          return;
        }

        // Cooldown expired → require re-entry
        showView("view-reenter");
      },
    );
  }

  // ---------- Load redirects ----------
  chrome.storage.local.get(["redirectsToday"], (data) => {
    const redirectsEl = document.getElementById("redirects");
    if (redirectsEl) {
      redirectsEl.textContent = data.redirectsToday ?? 0;
    }
  });

  // ---------- Load streak data ----------
  const MAX_DAILY_REDIRECTS = 3;

  function updateStreakDisplay() {
    chrome.storage.local.get(
      ["streak", "redirectsToday", "streakBrokenToday"],
      ({ streak = 1, redirectsToday = 0, streakBrokenToday = false }) => {
        const streakEl = document.getElementById("streakValue");
        const streakSub = document.getElementById("streakSub");
        const streakCard = document.querySelector(".streak-card");

        if (!streakEl || !streakSub || !streakCard) return;

        // Ensure streak is valid
        streak = Math.max(1, streak);
        streakEl.textContent = streak;

        // Reset to default styles
        streakCard.style.border = "";
        streakCard.style.filter = "";

        // Dynamic messaging based on streak length
        let message;
        if (streak === 1) {
          message = "Starting fresh";
        } else if (streak < 3) {
          message = "Building consistency";
        } else if (streak < 7) {
          message = "Momentum is forming";
        } else if (streak < 14) {
          message = "Strong focus habit";
        } else if (streak < 30) {
          message = "Exceptional discipline";
        } else {
          message = "Master of focus";
        }

        // Color intensity based on streak
        const intensity = Math.min(streak / 20, 1);
        streakCard.style.filter = `saturate(${1 + intensity * 0.5}) brightness(${1 + intensity * 0.15})`;

        // Warning states
        if (streakBrokenToday) {
          streakSub.textContent = "⚠️ Streak will reset tomorrow";
          streakCard.style.border = "1px solid rgba(255,107,53,0.6)";
        } else if (redirectsToday === MAX_DAILY_REDIRECTS) {
          streakSub.textContent = "⚠️ One more block resets your streak";
          streakCard.style.border = "1px solid rgba(255,107,53,0.4)";
        } else if (redirectsToday === MAX_DAILY_REDIRECTS - 1) {
          streakSub.textContent = `⚠️ ${MAX_DAILY_REDIRECTS - redirectsToday} block left today`;
          streakCard.style.border = "1px solid rgba(255,165,0,0.4)";
        } else {
          streakSub.textContent = message;
        }
      },
    );
  }

  // Initial load
  updateStreakDisplay();

  // Update display when storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      area === "local" &&
      (changes.streak || changes.redirectsToday || changes.streakBrokenToday)
    ) {
      updateStreakDisplay();
    }
  });

  // ---------- Button wiring (NORMAL → CONFIRM → PASSPHRASE) ----------
  const disableBtn = document.getElementById("disableBtn");
  const confirmCancel = document.getElementById("confirmCancel");
  const confirmContinue = document.getElementById("confirmContinue");
  const enableBtn = document.getElementById("enableBtn");

  if (disableBtn) {
    disableBtn.addEventListener("click", () => {
      console.log("Disable clicked");
      handleDisableFlow();
    });
  }

  if (confirmCancel) {
    confirmCancel.addEventListener("click", () => {
      console.log("Disable cancelled");
      showView("view-normal");
    });
  }

  if (confirmContinue) {
    confirmContinue.addEventListener("click", () => {
      console.log("Confirm continue");

      chrome.storage.local.get("cooldownUntil", ({ cooldownUntil }) => {
        // Safety: confirmation should only be usable when no cooldown exists
        if (cooldownUntil && cooldownUntil > Date.now()) {
          showView("view-cooldown");
          startCooldownTimer(cooldownUntil);
          return;
        }

        // Normal flow
        showView("view-passphrase");
      });
    });
  }

  if (enableBtn) {
    enableBtn.addEventListener("click", () => {
      chrome.storage.local.set({ enabled: true }, () => {
        console.log("CleanTab enabled");
        syncEnabledUI(true);
      });
    });
  }

  // ---------- Passphrase logic ----------
  const PASSPHRASE = "I choose long-term focus over short-term impulse.";

  function wirePassphraseView(viewSelector, onSuccess) {
    const input = document.querySelector(`${viewSelector} .text-input`);
    const btn = document.querySelector(`${viewSelector} .btn`);
    if (!input || !btn) return;

    btn.disabled = true;
    btn.classList.add("disabled");

    input.addEventListener("input", () => {
      const typed = input.value.trim();

      if (typed === PASSPHRASE) {
        btn.disabled = false;
        btn.classList.remove("disabled");
      } else {
        btn.disabled = true;
        btn.classList.add("disabled");
      }
    });

    input.addEventListener("paste", (e) => e.preventDefault());
    input.addEventListener("drop", (e) => e.preventDefault());

    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      onSuccess();
    });
  }

  // First passphrase → start cooldown
  wirePassphraseView(".view-passphrase", () => {
    const cooldownSeconds = 10;
    const cooldownUntil = Date.now() + cooldownSeconds * 1000;

    chrome.storage.local.set({ cooldownUntil }, () => {
      console.log("Cooldown started until:", new Date(cooldownUntil));
      showView("view-cooldown");
      startCooldownTimer(cooldownUntil);
    });
  });

  // Re-enter passphrase → FINAL disable (for now just clear cooldown)
  wirePassphraseView(".view-reenter", () => {
    chrome.storage.local.remove("cooldownUntil", () => {
      chrome.storage.local.set({ enabled: false, streak: 1 }, () => {
        console.log("CleanTab disabled - streak reset to 1");
        showView("view-normal");
        syncEnabledUI(false);
      });
    });
  });

  let cooldownInterval = null;

  function startCooldownTimer(cooldownUntil) {
    const timerEl = document.getElementById("cooldown-timer");
    if (!timerEl) return;

    if (cooldownInterval) clearInterval(cooldownInterval);

    function tick() {
      const remaining = cooldownUntil - Date.now();

      if (remaining <= 0) {
        clearInterval(cooldownInterval);
        timerEl.textContent = "00:00:00";
        showView("view-reenter");
        return;
      }

      timerEl.textContent = formatTime(remaining);
    }

    tick();
    cooldownInterval = setInterval(tick, 1000);
  }

  const cancelCooldownBtn = document.getElementById("cancelCooldown");

  if (cancelCooldownBtn) {
    cancelCooldownBtn.addEventListener("click", () => {
      chrome.storage.local.remove("cooldownUntil", () => {
        console.log("Cooldown cancelled");
        if (cooldownInterval) clearInterval(cooldownInterval);
        showView("view-normal");
      });
    });
  }

  // Debug functionality - add to extension footer
  const footer = document.querySelector("footer");
  if (footer) {
    // Add debug button (hidden by default)
    const debugBtn = document.createElement("button");
    debugBtn.textContent = "🔧";
    debugBtn.style.cssText = `
      position: absolute; 
      bottom: 5px; 
      right: 5px; 
      background: none; 
      border: none; 
      opacity: 0.3; 
      cursor: pointer;
      font-size: 12px;
    `;
    debugBtn.title = "Debug Tools";

    debugBtn.addEventListener("click", () => {
      const confirmed = confirm(
        "Clear all appeal data? This will reset rate limits and appeal history.",
      );
      if (confirmed) {
        chrome.runtime.sendMessage({ action: "clearAppealData" }, () => {
          alert("Appeal data cleared! Rate limits have been reset.");
          console.log("✅ Appeal data cleared from popup");
        });
      }
    });

    footer.style.position = "relative";
    footer.appendChild(debugBtn);
  }
});
