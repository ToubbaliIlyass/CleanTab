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

  // ---------- Ring + cumulative display ----------
  const RING_CIRCUMFERENCE = 301.6; // 2π × r=48

  function updateRingDisplay() {
    chrome.storage.local.get(
      ["today", "goalMinutes", "totals"],
      ({ today = {}, goalMinutes = 120, totals = {} }) => {
        const cleanMinutes = today.cleanMinutes || 0;
        const pct = Math.min(1, cleanMinutes / goalMinutes);

        // Ring arc
        const fillEl = document.getElementById("ringFill");
        const pctEl = document.getElementById("ringPct");
        const subEl = document.getElementById("ringSub");
        if (fillEl) {
          const filled = pct * RING_CIRCUMFERENCE;
          fillEl.setAttribute("stroke-dasharray", `${filled} ${RING_CIRCUMFERENCE}`);
        }
        if (pctEl) pctEl.textContent = `${Math.round(pct * 100)}%`;
        if (subEl) {
          const remaining = Math.max(0, goalMinutes - cleanMinutes);
          subEl.textContent = remaining > 0
            ? `${remaining} min to close the ring`
            : "Ring closed today";
        }

        // Redirects today (from v1 schema)
        const redirectsEl = document.getElementById("redirects");
        if (redirectsEl) redirectsEl.textContent = today.redirects ?? 0;

        // Cumulative
        const closedEl = document.getElementById("closedDays");
        const reflEl = document.getElementById("reflectionsTotal");
        const hrsEl = document.getElementById("lifetimeHours");
        if (closedEl) closedEl.textContent = totals.closedDays ?? 0;
        if (reflEl) reflEl.textContent = totals.reflectionsLogged ?? 0;
        if (hrsEl) hrsEl.textContent = Math.floor((totals.lifetimeCleanMinutes ?? 0) / 60);
      },
    );
  }

  updateRingDisplay();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.today || changes.totals || changes.goalMinutes)) {
      updateRingDisplay();
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
      chrome.storage.local.remove("disableUntil", () => {
        chrome.storage.local.set({ enabled: true }, () => {
          console.log("CleanTab enabled");
          if (disableTimerInterval) clearInterval(disableTimerInterval);
          syncEnabledUI(true);

          const ringCard = document.getElementById("ringCard");
          const timerCard = document.getElementById("disableTimerCard");
          if (ringCard) ringCard.style.display = "flex";
          if (timerCard) timerCard.style.display = "none";
        });
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

  // Re-enter passphrase → Show duration selection
  wirePassphraseView(".view-reenter", () => {
    chrome.storage.local.remove("cooldownUntil", () => {
      console.log("Passphrase confirmed - showing duration selection");
      showView("view-duration");
    });
  });

  let cooldownInterval = null;
  let disableTimerInterval = null;

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

  const cancelReenterBtn = document.getElementById("cancelReenter");

  if (cancelReenterBtn) {
    cancelReenterBtn.addEventListener("click", () => {
      chrome.storage.local.remove("cooldownUntil", () => {
        console.log("Re-enter passphrase cancelled");
        showView("view-normal");
      });
    });
  }

  const cancelPassphraseBtn = document.getElementById("cancelPassphrase");

  if (cancelPassphraseBtn) {
    cancelPassphraseBtn.addEventListener("click", () => {
      console.log("Passphrase entry cancelled");
      showView("view-normal");
    });
  }

  // Duration selection handlers
  const durationButtons = document.querySelectorAll(".duration-btn");
  const cancelDurationBtn = document.getElementById("cancelDuration");

  durationButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const minutes = parseInt(btn.dataset.minutes);
      const disableUntil = Date.now() + minutes * 60 * 1000;

      chrome.storage.local.set(
        { enabled: false, streak: 1, disableUntil },
        () => {
          console.log(
            `CleanTab disabled for ${minutes} minutes - streak reset to 1`,
          );
          showView("view-normal");
          syncEnabledUI(false);
          startDisableTimer(disableUntil);
        },
      );
    });
  });

  if (cancelDurationBtn) {
    cancelDurationBtn.addEventListener("click", () => {
      console.log("Duration selection cancelled");
      showView("view-normal");
    });
  }

  // Disable timer management
  function startDisableTimer(disableUntil) {
    const timerEl = document.getElementById("disableTimer");
    const ringCard = document.getElementById("ringCard");
    const timerCard = document.getElementById("disableTimerCard");

    if (!timerEl || !ringCard || !timerCard) return;

    // Show timer, hide ring
    ringCard.style.display = "none";
    timerCard.style.display = "flex";

    if (disableTimerInterval) clearInterval(disableTimerInterval);

    function tick() {
      const remaining = disableUntil - Date.now();

      if (remaining <= 0) {
        clearInterval(disableTimerInterval);
        // Auto re-enable
        chrome.storage.local.remove("disableUntil", () => {
          chrome.storage.local.set({ enabled: true }, () => {
            console.log("CleanTab auto-enabled after timer expired");
            syncEnabledUI(true);
            ringCard.style.display = "flex";
            timerCard.style.display = "none";
          });
        });
        return;
      }

      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      timerEl.textContent = `${minutes}:${seconds.toString().padStart(2, "0")}`;
    }

    tick();
    disableTimerInterval = setInterval(tick, 1000);
  }

  // Check for active disable timer on popup open
  chrome.storage.local.get(
    ["enabled", "disableUntil"],
    ({ enabled, disableUntil }) => {
      if (enabled === false && disableUntil && disableUntil > Date.now()) {
        startDisableTimer(disableUntil);
      }
    },
  );

  // ── Heatmap (Phase 7) ──────────────────────────────────────────────────────
  function localDateKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function dateMinusDays(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${day}`;
  }

  function renderHeatmap(history, goalMinutes, todayData) {
    const grid = document.getElementById("heatmapGrid");
    if (!grid) return;
    grid.innerHTML = "";

    const todayKey = localDateKey();

    for (let i = 29; i >= 0; i--) {
      const key = dateMinusDays(i);
      let pct = 0;
      let hasData = false;

      if (key === todayKey && todayData) {
        pct = Math.min(1, (todayData.cleanMinutes || 0) / (goalMinutes || 120));
        hasData = true;
      } else if (history[key]) {
        const d = history[key];
        pct = Math.min(1, (d.cleanMinutes || 0) / (d.goalMinutes || goalMinutes || 120));
        hasData = true;
      }

      const cell = document.createElement("div");
      cell.className = "heatmap-cell";
      cell.title = key;

      if (!hasData) {
        cell.style.background = "#f0f0f0";
      } else if (pct >= 1) {
        cell.style.background = "#FF6B35";
      } else if (pct >= 0.75) {
        cell.style.background = "#ffb899";
      } else if (pct >= 0.5) {
        cell.style.background = "#ffd4c2";
      } else if (pct >= 0.25) {
        cell.style.background = "#ffe8df";
      } else {
        cell.style.background = "#f5f5f5";
      }

      grid.appendChild(cell);
    }
  }

  // ── Insights (Phase 9) ─────────────────────────────────────────────────────
  const CHIP_LABELS = {
    bored: "Bored", stressed: "Stressed", habit: "Habit",
    avoiding: "Avoiding", lonely: "Lonely", tired: "Tired",
  };

  function renderInsights(reflections, totals) {
    const section = document.getElementById("insightsSection");
    if (!section) return;
    if ((totals.reflectionsLogged || 0) < 10) return;

    section.style.display = "flex";

    const counts = {};
    Object.keys(CHIP_LABELS).forEach((k) => (counts[k] = 0));
    reflections.forEach((r) => { if (counts[r.chip] !== undefined) counts[r.chip]++; });

    const total = reflections.length || 1;
    const max = Math.max(...Object.values(counts), 1);

    const barsEl = document.getElementById("triggerBars");
    barsEl.innerHTML = "";

    Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .filter(([, count]) => count > 0)
      .forEach(([chip, count]) => {
        const pct = Math.round((count / total) * 100);
        const bar = document.createElement("div");
        bar.className = "trigger-bar";
        bar.innerHTML = `
          <span class="trigger-name">${CHIP_LABELS[chip]}</span>
          <div class="trigger-track">
            <div class="trigger-fill" style="width:${(count / max) * 100}%"></div>
          </div>
          <span class="trigger-pct">${pct}%</span>
        `;
        barsEl.appendChild(bar);
      });
  }

  // Load heatmap + insights on open and on storage change
  function loadSupplementaryData() {
    chrome.storage.local.get(
      ["history", "goalMinutes", "today", "totals", "reflections"],
      ({ history = {}, goalMinutes = 120, today = {}, totals = {}, reflections = [] }) => {
        renderHeatmap(history, goalMinutes, today);
        renderInsights(reflections, totals);
      },
    );
  }

  loadSupplementaryData();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.history || changes.reflections || changes.today)) {
      loadSupplementaryData();
    }
  });

  // ── Export / Import (Phase 11) ─────────────────────────────────────────────
  document.getElementById("exportBtn")?.addEventListener("click", () => {
    chrome.storage.local.get(null, (data) => {
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cleantab-backup-${localDateKey()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  });

  document.getElementById("importBtn")?.addEventListener("click", () => {
    document.getElementById("importFile")?.click();
  });

  document.getElementById("importFile")?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.schemaVersion) throw new Error("Invalid backup");
        chrome.storage.local.set(data, () => {
          alert("Data restored. Reopen the popup to see your history.");
        });
      } catch {
        alert("Could not read this file. Make sure it is a valid CleanTab backup.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

});

