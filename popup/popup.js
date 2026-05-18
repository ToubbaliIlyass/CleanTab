document.addEventListener("DOMContentLoaded", () => {

  // ── Tab navigation ─────────────────────────────────────────────────────────
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.add("hidden"));
      tab.classList.add("active");
      document.getElementById(`panel-${tab.dataset.tab}`)?.classList.remove("hidden");
    });
  });

  // ── View switcher (disable flow overlays) ─────────────────────────────────
  function showView(viewClass) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("is-active"));
    document.querySelector(`.${viewClass}`)?.classList.add("is-active");
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function formatTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}h ${m}m ${sec}s`;
  }

  function localDateKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  function syncEnabledUI(enabled) {
    const badge = document.getElementById("statusBadge");
    const dis = document.getElementById("disableBtn");
    const en = document.getElementById("enableBtn");
    if (!badge) return;
    if (enabled) {
      badge.innerHTML = '<span class="badge-dot"></span><span class="badge-label">Active</span>';
      badge.className = "badge on";
      if (dis) dis.style.display = "";
      if (en) en.style.display = "none";
    } else {
      badge.innerHTML = '<span class="badge-dot"></span><span class="badge-label">Inactive</span>';
      badge.className = "badge off";
      if (dis) dis.style.display = "none";
      if (en) en.style.display = "";
    }
  }

  function attachPassphraseGuards(viewSel) {
    const input = document.querySelector(`${viewSel} .text-input`);
    if (!input) return;
    input.addEventListener("paste", (e) => e.preventDefault());
    input.addEventListener("drop", (e) => e.preventDefault());
  }
  attachPassphraseGuards(".view-passphrase");
  attachPassphraseGuards(".view-reenter");

  // ── Ring display ───────────────────────────────────────────────────────────
  const CIRC = 477.52; // 2π × r=76

  function updateRingDisplay() {
    chrome.storage.local.get(
      ["today", "goalMinutes", "totals"],
      ({ today = {}, goalMinutes = 120, totals = {} }) => {
        const mins = today.cleanMinutes || 0;
        const pct = Math.min(1, mins / goalMinutes);

        const fill = document.getElementById("ringFill");
        const pctEl = document.getElementById("ringPct");
        const sub = document.getElementById("ringSub");
        if (fill) fill.setAttribute("stroke-dasharray", `${pct * CIRC} ${CIRC}`);
        if (pctEl) pctEl.textContent = `${Math.round(pct * 100)}%`;
        if (sub) {
          const rem = Math.max(0, goalMinutes - mins);
          sub.textContent = rem > 0 ? `${rem} min to close` : "Ring closed today";
        }

        const d = document.getElementById("todayRedirects");
        const c = document.getElementById("closedDays");
        const r = document.getElementById("reflectionsTotal");
        if (d) d.textContent = today.redirects ?? 0;
        if (c) c.textContent = totals.closedDays ?? 0;
        if (r) r.textContent = totals.reflectionsLogged ?? 0;
      }
    );
  }

  updateRingDisplay();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.today || changes.totals || changes.goalMinutes)) {
      updateRingDisplay();
    }
  });

  // ── Init: enabled state & cooldown ────────────────────────────────────────
  chrome.storage.local.get(["enabled", "cooldownUntil", "disableUntil"], (data) => {
    syncEnabledUI(data.enabled !== false);
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
  });

  // ── Disable flow ───────────────────────────────────────────────────────────
  function handleDisableFlow() {
    chrome.storage.local.get(["enabled", "cooldownUntil"], ({ enabled, cooldownUntil }) => {
      if (enabled === false) { showView("view-normal"); return; }
      if (!cooldownUntil) { showView("view-confirm"); return; }
      if (cooldownUntil > Date.now()) { showView("view-cooldown"); startCooldownTimer(cooldownUntil); return; }
      showView("view-reenter");
    });
  }

  document.getElementById("disableBtn")?.addEventListener("click", handleDisableFlow);
  document.getElementById("confirmCancel")?.addEventListener("click", () => showView("view-normal"));
  document.getElementById("confirmContinue")?.addEventListener("click", () => {
    chrome.storage.local.get("cooldownUntil", ({ cooldownUntil }) => {
      if (cooldownUntil && cooldownUntil > Date.now()) {
        showView("view-cooldown"); startCooldownTimer(cooldownUntil);
      } else {
        showView("view-passphrase");
      }
    });
  });
  document.getElementById("cancelPassphrase")?.addEventListener("click", () => showView("view-normal"));
  document.getElementById("cancelCooldown")?.addEventListener("click", () => {
    chrome.storage.local.remove("cooldownUntil", () => {
      if (cooldownInterval) clearInterval(cooldownInterval);
      showView("view-normal");
    });
  });
  document.getElementById("cancelReenter")?.addEventListener("click", () => {
    chrome.storage.local.remove("cooldownUntil", () => showView("view-normal"));
  });
  document.getElementById("cancelDuration")?.addEventListener("click", () => showView("view-normal"));

  document.getElementById("enableBtn")?.addEventListener("click", () => {
    chrome.storage.local.remove("disableUntil", () => {
      chrome.storage.local.set({ enabled: true }, () => {
        if (disableTimerInterval) clearInterval(disableTimerInterval);
        syncEnabledUI(true);
        const rc = document.getElementById("ringCard");
        const tc = document.getElementById("disableTimerCard");
        if (rc) rc.style.display = "";
        if (tc) tc.style.display = "none";
      });
    });
  });

  // ── Passphrase wiring ─────────────────────────────────────────────────────
  const PASSPHRASE = "I choose long-term focus over short-term impulse.";

  function wirePassphrase(viewSel, onSuccess) {
    const input = document.querySelector(`${viewSel} .text-input`);
    const btn = document.querySelector(`${viewSel} .btn`);
    if (!input || !btn) return;
    btn.disabled = true;
    btn.classList.add("disabled");
    input.addEventListener("input", () => {
      const match = input.value.trim() === PASSPHRASE;
      btn.disabled = !match;
      btn.classList.toggle("disabled", !match);
    });
    input.addEventListener("paste", (e) => e.preventDefault());
    input.addEventListener("drop", (e) => e.preventDefault());
    btn.addEventListener("click", () => { if (!btn.disabled) onSuccess(); });
  }

  wirePassphrase(".view-passphrase", () => {
    const until = Date.now() + 10 * 1000;
    chrome.storage.local.set({ cooldownUntil: until }, () => {
      showView("view-cooldown");
      startCooldownTimer(until);
    });
  });

  wirePassphrase(".view-reenter", () => {
    chrome.storage.local.remove("cooldownUntil", () => showView("view-duration"));
  });

  // ── Timers ─────────────────────────────────────────────────────────────────
  let cooldownInterval = null;
  let disableTimerInterval = null;

  function startCooldownTimer(until) {
    const el = document.getElementById("cooldown-timer");
    if (!el) return;
    if (cooldownInterval) clearInterval(cooldownInterval);
    function tick() {
      const rem = until - Date.now();
      if (rem <= 0) { clearInterval(cooldownInterval); el.textContent = "0h 0m 0s"; showView("view-reenter"); return; }
      el.textContent = formatTime(rem);
    }
    tick();
    cooldownInterval = setInterval(tick, 1000);
  }

  function startDisableTimer(until) {
    const el = document.getElementById("disableTimer");
    const rc = document.getElementById("ringCard");
    const tc = document.getElementById("disableTimerCard");
    if (!el) return;
    if (rc) rc.style.display = "none";
    if (tc) tc.style.display = "flex";
    if (disableTimerInterval) clearInterval(disableTimerInterval);
    function tick() {
      const rem = until - Date.now();
      if (rem <= 0) {
        clearInterval(disableTimerInterval);
        chrome.storage.local.remove("disableUntil", () => {
          chrome.storage.local.set({ enabled: true }, () => {
            syncEnabledUI(true);
            if (rc) rc.style.display = "";
            if (tc) tc.style.display = "none";
          });
        });
        return;
      }
      const m = Math.floor(rem / 60000);
      const s = Math.floor((rem % 60000) / 1000);
      el.textContent = `${m}:${String(s).padStart(2, "0")}`;
    }
    tick();
    disableTimerInterval = setInterval(tick, 1000);
  }

  // ── Duration buttons ───────────────────────────────────────────────────────
  document.querySelectorAll(".dur-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mins = parseInt(btn.dataset.minutes);
      const until = Date.now() + mins * 60 * 1000;
      chrome.storage.local.set({ enabled: false, disableUntil: until }, () => {
        showView("view-normal");
        syncEnabledUI(false);
        startDisableTimer(until);
      });
    });
  });

  // ── Heatmap (16-week calendar grid) ───────────────────────────────────────
  function renderHeatmap(history, goalMinutes, todayData) {
    const grid = document.getElementById("heatmapGrid");
    if (!grid) return;
    grid.innerHTML = "";

    const todayKey = localDateKey();
    const today = new Date();
    // Align so rightmost column ends at Sunday of current week
    const dow = (today.getDay() + 6) % 7; // Mon=0 … Sun=6
    const daysToSunday = 6 - dow;
    const gridEnd = new Date(today);
    gridEnd.setDate(gridEnd.getDate() + daysToSunday);

    const TOTAL = 16 * 7; // 112 cells

    for (let i = TOTAL - 1; i >= 0; i--) {
      const d = new Date(gridEnd);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      const isFuture = d > today;

      let pct = -1;
      if (!isFuture) {
        if (key === todayKey && todayData) {
          pct = Math.min(1, (todayData.cleanMinutes || 0) / (goalMinutes || 120));
        } else if (history[key]) {
          const h = history[key];
          pct = Math.min(1, (h.cleanMinutes || 0) / (h.goalMinutes || goalMinutes || 120));
        } else {
          pct = 0;
        }
      }

      const cell = document.createElement("div");
      cell.className = "hm-cell";
      cell.title = isFuture ? "" : key;

      if (isFuture) {
        cell.style.background = "transparent";
        cell.style.border = "1px solid #EEEBE5";
      } else if (pct >= 1)    cell.style.background = "#FF6B35";
      else if (pct >= 0.75)   cell.style.background = "#FFAA7A";
      else if (pct >= 0.5)    cell.style.background = "#FFD0B5";
      else if (pct >= 0.25)   cell.style.background = "#FFE9DB";
      else if (pct > 0)       cell.style.background = "#FFF3ED";
      else                    cell.style.background = "#F0EDE7";

      grid.appendChild(cell);
    }
  }

  // ── Insights ───────────────────────────────────────────────────────────────
  const CHIPS = { bored:"Bored", stressed:"Stressed", habit:"Habit", avoiding:"Avoiding", lonely:"Lonely", tired:"Tired" };

  function renderInsights(reflections, totals) {
    const section = document.getElementById("insightsSection");
    const emptyEl = document.getElementById("insightsEmpty");
    const bars = document.getElementById("triggerBars");
    if (!section || !bars) return;

    if ((totals.reflectionsLogged || 0) < 10) {
      section.style.display = "none";
      if (emptyEl) emptyEl.style.display = "";
      return;
    }

    if (emptyEl) emptyEl.style.display = "none";
    section.style.display = "flex";
    bars.innerHTML = "";

    const counts = {};
    Object.keys(CHIPS).forEach((k) => counts[k] = 0);
    reflections.forEach((r) => { if (counts[r.chip] !== undefined) counts[r.chip]++; });

    const total = reflections.length || 1;
    const max = Math.max(...Object.values(counts), 1);

    Object.entries(counts)
      .sort(([,a],[,b]) => b - a)
      .filter(([,c]) => c > 0)
      .forEach(([chip, count]) => {
        const pct = Math.round((count / total) * 100);
        const row = document.createElement("div");
        row.className = "trigger-bar";
        row.innerHTML = `
          <span class="trigger-name">${CHIPS[chip]}</span>
          <div class="trigger-track"><div class="trigger-fill" style="width:${(count/max)*100}%"></div></div>
          <span class="trigger-pct">${pct}%</span>`;
        bars.appendChild(row);
      });
  }

  function loadProgress() {
    chrome.storage.local.get(
      ["history","goalMinutes","today","totals","reflections"],
      ({ history={}, goalMinutes=120, today={}, totals={}, reflections=[] }) => {
        renderHeatmap(history, goalMinutes, today);
        renderInsights(reflections, totals);
      }
    );
  }

  loadProgress();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.history || changes.reflections || changes.today)) {
      loadProgress();
    }
  });

  // ── Export / Import ────────────────────────────────────────────────────────
  document.getElementById("exportBtn")?.addEventListener("click", () => {
    chrome.storage.local.get(null, (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: `cleantab-${localDateKey()}.json` });
      document.body.append(a); a.click(); a.remove();
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
        if (!data.schemaVersion) throw new Error();
        chrome.storage.local.set(data, () => alert("Data restored. Reopen the popup."));
      } catch { alert("Invalid CleanTab backup file."); }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

});
