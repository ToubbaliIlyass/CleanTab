// The weekly report — everything it says, as pure functions over what is already stored.
//
// Shown to the person using CleanTab, on their device, and to nobody else. There is no
// new data here: it reads the daily history, the reflection log and the recent-blocks
// log, and compares the last seven days with the seven before them.
//
// Wording rule, same as the rest of the product: counts and patterns, never a verdict.
// Fewer slips is said plainly; more slips is said without a scolding.

const REPORT_DAYS = 7;
const REPORT_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
const REPORT_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const REPORT_FEELINGS = {
  bored: "Bored", stressed: "Stressed", habit: "Habit", avoiding: "Avoiding something",
  lonely: "Lonely", tired: "Tired", curious: "Just curious", unsure: "Not sure",
};
// [key, label, first hour, last hour (exclusive, may wrap)]
const REPORT_DAYPARTS = [
  ["morning", "in the morning", 5, 12],
  ["afternoon", "in the afternoon", 12, 17],
  ["evening", "in the evening", 17, 22],
  ["night", "late at night", 22, 5],
];

function reportDateOf(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function reportDaypart(hour) {
  for (const [key, label, from, to] of REPORT_DAYPARTS) {
    const inside = from < to ? hour >= from && hour < to : hour >= from || hour < to;
    if (inside) return { key, label };
  }
  return { key: "night", label: "late at night" };
}

// Totals for one run of days. `days` is [{ key, day }], oldest first.
function reportTotals(days) {
  const t = {
    protected: 0, slips: 0, notCounted: 0,
    blocked: 0, walkedAway: 0, openedAnyway: 0, switchedOff: 0,
    reflections: 0, focusMinutes: 0, browsedMinutes: 0, tracked: 0,
  };
  for (const { day } of days) {
    const state = dayState(day);
    if (state === "protected") t.protected += 1;
    else if (state === "quiet") t.notCounted += 1;
    else t.slips += 1;
    if (!day) continue;
    t.tracked += 1;
    t.blocked += day.redirects || 0;
    t.walkedAway += day.leaves || 0;
    t.openedAnyway += day.passes || 0;
    t.switchedOff += (day.pauses || 0) + (day.offs || 0);
    t.reflections += day.reflections || 0;
    t.focusMinutes += day.focusMinutes || 0;
    t.browsedMinutes += day.browsedMinutes || 0;
  }
  return t;
}

// The whole report.
//   history, today, todayKey   as stored
//   reflections                [{ ts, chip }]
//   blocks                     [{ ts }]  the recent-blocks log (last 25)
//   plans                      { chip: "if-then plan" }
//   totals                     lifetime counters
function weekReport({ history, today, todayKey, reflections, blocks, plans, totals }, now = Date.now()) {
  const dayOf = (key) => (key === todayKey ? today : (history || {})[key]);
  const run = (keys) => keys.map((key) => ({ key, day: dayOf(key) }));

  const keys = windowKeys(todayKey, REPORT_DAYS);
  const first = reportDateOf(keys[0]);
  const before = new Date(first.getFullYear(), first.getMonth(), first.getDate() - 1);
  const beforeKey = `${before.getFullYear()}-${String(before.getMonth() + 1).padStart(2, "0")}-${String(before.getDate()).padStart(2, "0")}`;
  const prevKeys = windowKeys(beforeKey, REPORT_DAYS);

  const days = run(keys).map(({ key, day }) => {
    const date = reportDateOf(key);
    const state = dayState(day);
    return {
      key,
      weekday: REPORT_WEEKDAYS[date.getDay()],
      letter: REPORT_WEEKDAYS[date.getDay()][0],
      // "passed" and "paused" are one thing to the reader: a slip.
      state: state === "protected" ? "protected" : state === "quiet" ? "notCounted" : "slip",
      blocked: (day && day.redirects) || 0,
      focusMinutes: (day && day.focusMinutes) || 0,
      isToday: key === todayKey,
    };
  });

  const week = reportTotals(run(keys));
  const prev = reportTotals(run(prevKeys));
  // Only compare with a week that actually has something in it.
  const hasPrev = prev.tracked > 0;
  const delta = (field) => (hasPrev ? week[field] - prev[field] : null);

  // Hardest day: the one with the most blocks. One block is not a pattern.
  const hardest = days.reduce((best, d) => (d.blocked > (best ? best.blocked : 1) ? d : best), null);

  // When blocks happen. Reflections and the recent-blocks log both carry a time.
  const weekStart = first.getTime();
  const times = [
    ...(reflections || []).map((r) => r && r.ts),
    ...(blocks || []).map((b) => b && b.ts),
  ].filter((ts) => typeof ts === "number" && ts >= weekStart && ts <= now);
  const partCounts = {};
  for (const ts of times) {
    const part = reportDaypart(new Date(ts).getHours());
    partCounts[part.key] = (partCounts[part.key] || 0) + 1;
  }
  const topPart = Object.entries(partCounts).sort(([, a], [, b]) => b - a)[0];
  const daypart = topPart && times.length >= 3 && topPart[1] / times.length >= 0.5
    ? { ...REPORT_DAYPARTS.map(([key, label]) => ({ key, label })).find((p) => p.key === topPart[0]), share: topPart[1] / times.length }
    : null;

  // What was going on, by how often it was picked.
  const chipCounts = {};
  for (const r of reflections || []) {
    if (!r || typeof r.ts !== "number" || r.ts < weekStart || r.ts > now || !REPORT_FEELINGS[r.chip]) continue;
    chipCounts[r.chip] = (chipCounts[r.chip] || 0) + 1;
  }
  const feelings = Object.entries(chipCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([chip, count]) => ({ chip, label: REPORT_FEELINGS[chip], count }));
  const topFeeling = feelings[0]
    ? { ...feelings[0], plan: ((plans || {})[feelings[0].chip] || "").trim() || null }
    : null;

  const report = {
    from: keys[0],
    to: keys[keys.length - 1],
    days,
    week,
    prev: hasPrev ? prev : null,
    delta: {
      protected: delta("protected"), slips: delta("slips"), blocked: delta("blocked"),
      walkedAway: delta("walkedAway"), openedAnyway: delta("openedAnyway"),
      focusMinutes: delta("focusMinutes"), reflections: delta("reflections"),
    },
    walkedAwayShare: week.blocked ? Math.min(1, week.walkedAway / week.blocked) : null,
    hardestDay: hardest ? { weekday: hardest.weekday, blocked: hardest.blocked } : null,
    daypart,
    feelings,
    topFeeling,
    bestRun: bestRun(history, today, todayKey),
    lifetime: lifetimeProtected(totals, today),
  };
  report.headline = reportHeadline(report);
  return report;
}

// One sentence at the top. Picks the most encouraging thing that is actually true.
function reportHeadline(r) {
  const w = r.week;
  if (w.protected === REPORT_DAYS) return "Seven for seven. A full week protected.";
  if (r.delta.slips !== null && r.delta.slips < 0) return "Fewer slips than the week before.";
  if (r.delta.protected !== null && r.delta.protected > 0) return "More protected days than the week before.";
  if (w.protected >= 5) return "A strong week.";
  if (w.slips === 0 && w.protected > 0) return "A steady week, with nothing let through.";
  if (w.slips > 0 && w.protected > 0) return "A mixed week. That's information, not a verdict.";
  if (w.slips > 0) return "A hard week. It is one week, and the next one starts now.";
  return "A quiet week. Not much browsing to count.";
}

// Is it time to put the report in front of the reader?
//   firstDayKey  earliest day CleanTab has anything for
//   seenAt       when a report was last dismissed
function reportDue(firstDayKey, todayKey, seenAt, now = Date.now()) {
  if (!firstDayKey || !todayKey) return false;
  const days = Math.round((reportDateOf(todayKey) - reportDateOf(firstDayKey)) / (24 * 60 * 60 * 1000));
  if (days < REPORT_DAYS) return false;
  return !seenAt || now - seenAt >= REPORT_EVERY_MS;
}

// Asking for a coffee. Only in the popup, never on the pause screen: that screen meets
// someone at a hard moment and must not ask them for anything. It waits a week, comes
// after the first report rather than beside it (the caller checks), and any answer,
// including "not now", puts it away for three months. It is a link and nothing else: the
// extension itself contacts nobody.
const SUPPORT_URL = "https://ko-fi.com/ilyasstoubbali";
const SUPPORT_AFTER_DAYS = 7;
const SUPPORT_EVERY_MS = 90 * 24 * 60 * 60 * 1000;

function supportDue(firstDayKey, todayKey, seenAt, now = Date.now()) {
  if (!firstDayKey || !todayKey) return false;
  const days = Math.round((reportDateOf(todayKey) - reportDateOf(firstDayKey)) / (24 * 60 * 60 * 1000));
  if (days < SUPPORT_AFTER_DAYS) return false;
  return !seenAt || now - seenAt >= SUPPORT_EVERY_MS;
}

function reportFirstDay(history, today) {
  const keys = Object.keys(history || {});
  if (today && today.date) keys.push(today.date);
  return keys.sort()[0] || null;
}

// "+2", "-1", "same". Minutes are passed through focusMinutesText by the caller.
function reportDeltaText(n) {
  if (n === null || n === undefined) return "";
  if (n === 0) return "same as last week";
  return `${n > 0 ? "+" : "−"}${Math.abs(n)} vs last week`;
}

// Plain text for the copy button: counts only, never sites.
function reportSummary(r) {
  const w = r.week;
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const lines = [
    `Protected ${w.protected} of the last ${REPORT_DAYS} days` + (w.slips ? `, ${plural(w.slips, "slip")}` : ""),
    `${w.blocked} blocked, walked away from ${w.walkedAway}, opened ${w.openedAnyway} anyway`,
  ];
  if (w.focusMinutes) lines.push(`Focused for ${focusMinutesText(w.focusMinutes)}`);
  if (r.topFeeling) lines.push(`Most common feeling: ${r.topFeeling.label}`);
  if (r.hardestDay) lines.push(`Hardest day: ${r.hardestDay.weekday}`);
  return `CleanTab, my week: ${lines.join(". ")}.`;
}
