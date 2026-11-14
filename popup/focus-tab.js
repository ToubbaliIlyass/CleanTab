// The popup's Focus tab and the strip on the Now tab. Rules live in shared/focus.js; the
// worker enforces them. Starting and ending a session is a storage write, like every other
// setting, and open tabs pick it up through storage.onChanged.

document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const KEYS = ["focus", "focusSession", "focusSkipUntil", "today", "history"];
  const DAY_LETTERS = [["M", 1], ["T", 2], ["W", 3], ["T", 4], ["F", 5], ["S", 6], ["S", 0]];
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  let state = {};
  let status = { active: false };
  let ticker = null;
  let endWait = null; // { timer, ready } while the "end early" breather runs

  // A session started by a stray tap can be cancelled outright for its first minute.
  // After that, ending early costs the breather.
  const GRACE_MS = 60 * 1000;
  const inGrace = () => status.active && status.source === "session" &&
    Date.now() - (status.startedAt || 0) < GRACE_MS;

  function paintEndButton() {
    if (endWait) return;
    $("focusEnd").textContent = inGrace() ? "Cancel" : "End early";
    $("focusEnd").disabled = false;
    $("focusEndCancel").style.display = "none";
  }

  const hourLabel = (h) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;

  function describeSchedule(schedule) {
    const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => (schedule.days || []).includes(d));
    let which;
    if (days.length === 7) which = "Every day";
    else if (days.join() === "1,2,3,4,5") which = "Weekdays";
    else if (days.join() === "6,0") which = "Weekends";
    else which = days.map((d) => DAY_NAMES[d]).join(", ");
    return `${which}, ${hourLabel(Number(schedule.startHour))} to ${hourLabel(Number(schedule.endHour))}.`;
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  async function saveSettings(change) {
    const { focus } = await storageGet(["focus"]);
    const next = focusSettings(focus);
    change(next);
    await storageSet({ focus: next });
  }

  async function startSession(minutes) {
    const mins = focusClampMinutes(minutes);
    if (!mins) return;
    const now = Date.now();
    // Focus sits on top of protection, so starting it ends any pause.
    await storageRemove(["disableUntil", "cooldownUntil"]);
    await storageSet({
      enabled: true,
      focusSession: { startedAt: now, until: now + mins * 60000 },
      // Starting by hand outranks an earlier "skip the rest of today's schedule".
      focusSkipUntil: null,
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────

  function paintClock() {
    if (!status.active) return;
    const left = status.until - Date.now();
    if (left <= 0) { load(); return; }
    const total = Math.ceil(left / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    $("focusTimer").textContent = h
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
    $("focusStripText").textContent = `Focusing · ${focusRemainingText(left)} left`;
    paintEndButton();
  }

  function renderDurations() {
    const box = $("focusDurs");
    if (box.childElementCount) return;
    FOCUS_DURATIONS.forEach((mins) => {
      const btn = document.createElement("button");
      btn.className = "focus-dur";
      btn.type = "button";
      const n = document.createElement("b");
      n.textContent = String(mins);
      const unit = document.createElement("span");
      unit.textContent = "min";
      btn.append(n, unit);
      btn.setAttribute("aria-label", `Focus for ${mins} minutes`);
      btn.addEventListener("click", () => startSession(mins));
      box.appendChild(btn);
    });
  }

  function renderDays(settings, locked) {
    const box = $("focusDays");
    box.innerHTML = "";
    DAY_LETTERS.forEach(([letter, day]) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "day-chip";
      chip.textContent = letter;
      const on = settings.schedule.days.includes(day);
      chip.setAttribute("aria-pressed", String(on));
      chip.setAttribute("aria-label", DAY_NAMES[day]);
      chip.disabled = locked;
      chip.addEventListener("click", () => saveSettings((s) => {
        s.schedule.days = on ? s.schedule.days.filter((d) => d !== day) : [...s.schedule.days, day];
      }));
      box.appendChild(chip);
    });
  }

  function hourOptions(select, selected, locked) {
    select.innerHTML = "";
    for (let h = 0; h < 24; h++) {
      const opt = document.createElement("option");
      opt.value = String(h);
      opt.textContent = hourLabel(h);
      if (h === Number(selected)) opt.selected = true;
      select.appendChild(opt);
    }
    select.disabled = locked;
  }

  function renderSites(settings, locked) {
    const list = $("focusSiteList");
    list.innerHTML = "";
    settings.sites.forEach((domain) => {
      const row = document.createElement("div");
      row.className = "site-row";
      const info = document.createElement("div");
      info.className = "site-row-info";
      const name = document.createElement("span");
      name.className = "site-row-domain";
      name.textContent = domain;
      info.appendChild(name);
      const remove = document.createElement("button");
      remove.className = "row-btn";
      remove.textContent = "Remove";
      remove.disabled = locked;
      remove.addEventListener("click", () => saveSettings((s) => {
        s.sites = s.sites.filter((d) => d !== domain);
      }));
      row.append(info, remove);
      list.appendChild(row);
    });
  }

  function render() {
    const settings = focusSettings(state.focus);
    status = focusStatus(state);
    const active = status.active;

    renderDurations();
    $("focusIdle").style.display = active ? "none" : "";
    $("focusLive").style.display = active ? "" : "none";

    // Strip on the Now tab.
    const strip = $("focusStrip");
    strip.classList.toggle("on", active);
    $("focusStripGo").textContent = active ? "View" : `Start ${FOCUS_DURATIONS[0]} min`;
    if (!active) $("focusStripText").textContent = "Focus: close streaming and feeds";

    if (active) {
      $("focusLiveLabel").textContent = status.source === "schedule" ? "Scheduled focus" : "Focusing";
      $("focusUntil").textContent = `until ${focusClockText(status.until)}`;
      // Extending only makes sense for a session you started; a schedule ends when it ends.
      $("focusAdd").style.display = status.source === "session" ? "" : "none";
      paintEndButton();
      paintClock();
      if (!ticker) ticker = setInterval(paintClock, 1000);
    } else {
      if (ticker) { clearInterval(ticker); ticker = null; }
      stopEndWait();
    }

    // While focusing you can tighten the list but not loosen it; otherwise unticking a box
    // would be a quicker way out than the breather.
    $("focusLockedNote").style.display = active ? "" : "none";
    const streaming = $("focusCatStreaming");
    const feeds = $("focusCatFeeds");
    const keep = $("focusKeepYouTube");
    streaming.checked = settings.categories.streaming;
    feeds.checked = settings.categories.feeds;
    keep.checked = settings.keepYouTube;
    streaming.disabled = active && settings.categories.streaming;
    feeds.disabled = active && settings.categories.feeds;
    keep.disabled = !settings.categories.streaming || (active && !settings.keepYouTube);
    renderSites(settings, active);

    const sched = settings.schedule;
    $("focusSchedToggle").checked = Boolean(sched.enabled);
    $("focusSchedToggle").disabled = active && Boolean(sched.enabled);
    $("focusSchedSetup").style.display = sched.enabled ? "" : "none";
    const skipping = state.focusSkipUntil && state.focusSkipUntil > Date.now();
    $("focusSchedState").textContent = !sched.enabled
      ? "Off. Focus starts only when you start it."
      : skipping
        ? `${describeSchedule(sched)} Skipped until ${focusClockText(state.focusSkipUntil)}.`
        : describeSchedule(sched);
    renderDays(settings, active);
    hourOptions($("focusStart"), sched.startHour, active);
    hourOptions($("focusEndHour"), sched.endHour, active);

    const todayMin = (state.today || {}).focusMinutes || 0;
    const weekMin = focusMinutesInWindow(state.history || {}, state.today || {}, todayLocal(), 7);
    $("focusTally").textContent = weekMin
      ? `Focused ${focusMinutesText(todayMin)} today, ${focusMinutesText(weekMin)} this week.`
      : "";
  }

  async function load() {
    state = await storageGet(KEYS);
    render();
  }

  // ── End early: a 30-second breather, then one more tap ───────────────────

  function stopEndWait() {
    if (endWait) clearInterval(endWait.timer);
    endWait = null;
  }

  $("focusEnd").addEventListener("click", async () => {
    const btn = $("focusEnd");
    if (endWait?.ready || inGrace()) {
      stopEndWait();
      await storageSet(focusEndEarly(await storageGet(KEYS)));
      return;
    }
    if (endWait) return;
    let left = FOCUS_END_WAIT_S;
    btn.disabled = true;
    btn.textContent = `Breathe… ${left}`;
    $("focusEndCancel").style.display = "";
    endWait = {
      ready: false,
      timer: setInterval(() => {
        left -= 1;
        if (left > 0) { btn.textContent = `Breathe… ${left}`; return; }
        clearInterval(endWait.timer);
        endWait.ready = true;
        btn.disabled = false;
        btn.textContent = "End focus now";
      }, 1000),
    };
  });

  $("focusEndCancel").addEventListener("click", () => { stopEndWait(); render(); });

  $("focusAdd").addEventListener("click", async () => {
    const { focusSession } = await storageGet(["focusSession"]);
    if (!focusSession?.until || focusSession.until <= Date.now()) return;
    const cap = Date.now() + FOCUS_MAX_MINUTES * 60000;
    await storageSet({
      focusSession: { ...focusSession, until: Math.min(focusSession.until + 15 * 60000, cap) },
    });
  });

  // ── Controls ─────────────────────────────────────────────────────────────

  function startCustom() {
    const input = $("focusCustomMin");
    const mins = focusClampMinutes(input.value);
    if (!mins) { input.value = ""; input.placeholder = "A number of minutes, like 40"; return; }
    input.value = "";
    startSession(mins);
  }
  $("focusCustomStart").addEventListener("click", startCustom);
  $("focusCustomMin").addEventListener("keydown", (e) => { if (e.key === "Enter") startCustom(); });

  $("focusCatStreaming").addEventListener("change", (e) =>
    saveSettings((s) => { s.categories.streaming = e.target.checked; }));
  $("focusCatFeeds").addEventListener("change", (e) =>
    saveSettings((s) => { s.categories.feeds = e.target.checked; }));
  $("focusKeepYouTube").addEventListener("change", (e) =>
    saveSettings((s) => { s.keepYouTube = e.target.checked; }));

  function addSite() {
    const input = $("focusSiteInput");
    const raw = input.value.trim();
    if (!raw) return;
    const domain = raw.includes("://") ? domainFromUrl(raw) : normalizeDomain(raw.split("/")[0]);
    input.value = "";
    if (!domain || !domain.includes(".")) { input.placeholder = "Enter a domain like example.com"; return; }
    saveSettings((s) => { if (!s.sites.includes(domain)) s.sites.push(domain); });
  }
  $("focusSiteAdd").addEventListener("click", addSite);
  $("focusSiteInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addSite(); });

  $("focusSchedToggle").addEventListener("change", (e) =>
    saveSettings((s) => { s.schedule.enabled = e.target.checked; }));
  $("focusStart").addEventListener("change", (e) =>
    saveSettings((s) => { s.schedule.startHour = Number(e.target.value); }));
  $("focusEndHour").addEventListener("change", (e) =>
    saveSettings((s) => { s.schedule.endHour = Number(e.target.value); }));

  // The strip starts the shortest session in one tap, or opens the tab once one is running.
  $("focusStrip").addEventListener("click", () => {
    if (status.active) document.querySelector('.tab[data-tab="focus"]')?.click();
    else startSession(FOCUS_DURATIONS[0]);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (KEYS.some((k) => changes[k])) load();
  });

  load();
});
