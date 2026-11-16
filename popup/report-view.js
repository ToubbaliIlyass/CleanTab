// The weekly report view. What it says is decided in shared/report.js; this draws it.
// It appears on the Now tab once a week (after the first seven days of use) and can be
// opened any time from Progress. Everything is read from this device and stays on it.

document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const KEYS = ["history", "today", "totals", "reflections", "blocks", "ifThenPlans", "reportSeenAt"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  let summary = "";

  const shortDate = (key) => {
    const d = reportDateOf(key);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  };
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  function show(viewClass) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("is-active"));
    document.querySelector(`.${viewClass}`)?.classList.add("is-active");
  }

  function node(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // A change against last week. `good` says which direction is the welcome one, so the
  // colour follows the meaning rather than the sign. The other direction is plain, never red.
  function paintDelta(el, n, good, format = (x) => String(Math.abs(x))) {
    el.textContent = "";
    el.className = "report-delta";
    if (n === null || n === undefined) return;
    if (n === 0) { el.textContent = "same as last week"; return; }
    el.textContent = `${n > 0 ? "▲" : "▼"} ${format(n)} vs last week`;
    if ((good === "up" && n > 0) || (good === "down" && n < 0)) el.classList.add("good");
  }

  function bars(host, values, labels, describe, format) {
    host.innerHTML = "";
    const max = Math.max(...values, 1);
    values.forEach((v, i) => {
      const col = node("div", "report-bar");
      const n = node("span", "report-bar-n", v ? format(v) : "");
      const fill = node("i", v ? "" : "empty");
      fill.style.height = `${v ? Math.max(8, Math.round((v / max) * 100)) : 4}%`;
      const track = node("div", "report-bar-track");
      track.appendChild(fill);
      col.append(n, track, node("span", "report-bar-l", labels[i]));
      host.appendChild(col);
    });
    host.setAttribute("aria-label", describe);
  }

  function render(data, first) {
    const r = weekReport({
      history: data.history || {},
      today: data.today || {},
      todayKey: todayLocal(),
      reflections: data.reflections || [],
      blocks: data.blocks || [],
      plans: data.ifThenPlans || {},
      totals: data.totals || {},
    });
    const w = r.week;
    summary = reportSummary(r);

    $("reportTitle").textContent = first ? "Your first week" : "Your week";
    $("reportRange").textContent = `${shortDate(r.from)} to ${shortDate(r.to)}`;
    $("reportHeadline").textContent = r.headline;
    mountMascot($("mascotReport"), w.protected >= 5 ? "happy" : w.slips > w.protected ? "encourage" : "default");

    // ── The week, a day at a time ──
    $("reportProtected").textContent = String(w.protected);
    paintDelta($("reportProtectedDelta"), r.delta.protected, "up");
    const days = $("reportDays");
    days.innerHTML = "";
    const stateWords = { protected: "protected", slip: "a slip", notCounted: "not counted" };
    r.days.forEach((d) => {
      const li = node("li", `report-day ${d.state}${d.isToday ? " today" : ""}`);
      li.append(node("span", "report-day-dot"), node("span", "report-day-l", d.letter));
      li.title = `${d.weekday}: ${stateWords[d.state]}`;
      li.setAttribute("aria-label", li.title);
      days.appendChild(li);
    });

    // ── At the pause screen ──
    const grid = $("reportGrid");
    grid.innerHTML = "";
    const tiles = [
      ["Blocked", w.blocked, r.delta.blocked, null],
      ["Walked away", w.walkedAway, r.delta.walkedAway, "up"],
      ["Opened anyway", w.openedAnyway, r.delta.openedAnyway, "down"],
      ["Reflections", w.reflections, r.delta.reflections, "up"],
    ];
    tiles.forEach(([label, value, delta, good]) => {
      const tile = node("div", "report-tile");
      tile.append(node("b", "", String(value)), node("span", "report-tile-l", label));
      const d = node("span", "report-delta");
      paintDelta(d, delta, good);
      tile.appendChild(d);
      grid.appendChild(tile);
    });
    $("reportWalked").textContent = !w.blocked
      ? "Nothing was blocked this week."
      : r.walkedAwayShare >= 0.5
        ? `You walked away from ${w.walkedAway} of ${w.blocked}. That is the part that counts.`
        : w.walkedAway
          ? `You walked away from ${w.walkedAway} of ${w.blocked}.`
          : "“Close this and move on” is the button that builds the habit.";

    // ── Blocked, day by day ──
    const letters = r.days.map((d) => d.letter);
    $("reportBlocksSection").style.display = w.blocked ? "" : "none";
    bars($("reportBars"), r.days.map((d) => d.blocked), letters,
      "Pages blocked each day: " + r.days.map((d) => `${d.weekday} ${d.blocked}`).join(", "), String);

    // ── Focus ──
    $("reportFocusSection").style.display = w.focusMinutes || (r.prev && r.prev.focusMinutes) ? "" : "none";
    $("reportFocusTotal").textContent = focusMinutesText(w.focusMinutes);
    paintDelta($("reportFocusDelta"), r.delta.focusMinutes, "up", (n) => focusMinutesText(Math.abs(n)));
    bars($("reportFocusBars"), r.days.map((d) => d.focusMinutes), letters,
      "Minutes focused each day: " + r.days.map((d) => `${d.weekday} ${d.focusMinutes}`).join(", "),
      (v) => (v >= 60 ? `${Math.round(v / 6) / 10}h` : `${v}m`));

    // ── Patterns ──
    const patterns = [];
    if (r.hardestDay) patterns.push(`${r.hardestDay.weekday} was the hardest day: ${r.hardestDay.blocked} blocked.`);
    if (r.daypart) {
      patterns.push(r.daypart.share >= 0.9
        ? `Almost all of it happens ${r.daypart.label}.`
        : `Most of it (${Math.round(r.daypart.share * 100)}%) happens ${r.daypart.label}.`);
    }
    if (r.delta.slips !== null && r.delta.slips !== 0) {
      patterns.push(r.delta.slips < 0
        ? `${plural(w.slips, "slip")} this week, down from ${r.prev.slips}.`
        : `${plural(w.slips, "slip")} this week, ${r.prev.slips} the week before.`);
    }
    if (r.bestRun >= 2) patterns.push(`Your longest run of protected days so far: ${r.bestRun}.`);
    $("reportPatternsSection").style.display = patterns.length ? "" : "none";
    const list = $("reportPatterns");
    list.innerHTML = "";
    patterns.forEach((text) => list.appendChild(node("li", "", text)));

    // ── What was going on ──
    $("reportFeelingsSection").style.display = r.feelings.length ? "" : "none";
    const feelings = $("reportFeelings");
    feelings.innerHTML = "";
    const most = r.feelings[0] ? r.feelings[0].count : 1;
    r.feelings.slice(0, 4).forEach((f) => {
      const row = node("div", "trigger-bar");
      const track = node("div", "trigger-track");
      const fill = node("div", "trigger-fill");
      fill.style.width = `${(f.count / most) * 100}%`;
      track.appendChild(fill);
      row.append(node("span", "trigger-name", f.label), track, node("span", "trigger-pct", String(f.count)));
      feelings.appendChild(row);
    });
    $("reportPlan").textContent = !r.topFeeling ? ""
      : r.topFeeling.plan
        ? `Your plan for “${r.topFeeling.label}”: ${r.topFeeling.plan}`
        : `No plan yet for “${r.topFeeling.label}”. You can write one at your next pause.`;

    $("reportFoot").textContent =
      `${plural(r.lifetime, "protected day")} in total. All of this is counted on this device and never leaves it.`;
    $("reportScroll").scrollTop = 0;
  }

  async function open() {
    const data = await storageGet(KEYS);
    render(data, !data.reportSeenAt);
    show("view-report");
  }

  async function refreshStrip() {
    const data = await storageGet(["history", "today", "reportSeenAt", "supportSeenAt"]);
    const first = reportFirstDay(data.history, data.today);
    const due = reportDue(first, todayLocal(), data.reportSeenAt);
    $("reportStrip").style.display = due ? "" : "none";
    // One thing at a time: the report first, the coffee only once it has been read.
    $("supportStrip").style.display =
      !due && supportDue(first, todayLocal(), data.supportSeenAt) ? "" : "none";
    $("reportStripText").textContent = data.reportSeenAt ? "Your week is ready" : "Your first week is ready";
  }

  $("reportSupport").href = SUPPORT_URL;
  $("supportOpen").addEventListener("click", async () => {
    await storageSet({ supportSeenAt: Date.now() });
    chrome.tabs.create({ url: SUPPORT_URL });
  });
  $("supportLater").addEventListener("click", async () => {
    await storageSet({ supportSeenAt: Date.now() });
    refreshStrip();
  });
  $("reportStrip").addEventListener("click", open);
  $("reportOpen").addEventListener("click", open);
  $("reportDone").addEventListener("click", async () => {
    await storageSet({ reportSeenAt: Date.now() });
    show("view-normal");
    refreshStrip();
  });
  $("reportCopy").addEventListener("click", async () => {
    const btn = $("reportCopy");
    try {
      await navigator.clipboard.writeText(summary);
      btn.textContent = "Copied";
    } catch {
      btn.textContent = "Couldn't copy";
    }
    setTimeout(() => { btn.textContent = "Copy summary"; }, 2000);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.history || changes.reportSeenAt || changes.supportSeenAt)) refreshStrip();
  });

  refreshStrip();
});
