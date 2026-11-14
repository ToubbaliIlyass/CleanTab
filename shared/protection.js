// What counts as a protected day, how a quick pause is limited, and how the user's own
// blocklist is matched. Pure functions: no storage, no chrome.*, testable in Node.
//
// WHY THE RING CHANGED
//
// The old ring was clean minutes / browsed minutes. A flagged page is redirected within a
// second, so the only "unclean" minutes came from one-time pass-throughs, and anyone who
// browsed 20 minutes sat at about 100% every day without doing anything. It measured
// nothing and hid the one thing that is informative: whether you went through a block.
//
// A day now has one of four states, all derived from things the extension really sees:
//
//   protected  protection stayed on, nothing was passed through, and you browsed enough
//              (PROTECTED_MIN_BROWSED minutes on scanned pages) for that to mean something
//   passed     you used "Let me through once" at least once
//   paused     protection was switched off or paused (10-minute pause or a full disable)
//   quiet      too little browsing to say anything, and no override
//
// In the interface "passed" and "paused" are both shown as a slip, and "quiet" as "not
// counted": three things to understand instead of four. The two kinds of slip stay
// separate in storage because they are different facts.
//
// "Quiet" is neither good nor bad, so it never counts against anyone. The headline number
// is "N of the last 14 days protected", which a slip lowers by one and which then recovers
// as the days pass. Nothing resets to zero.

const PROTECTED_MIN_BROWSED = 10; // minutes of scanned browsing
const PROTECTION_WINDOW_DAYS = 14;
const PROTECTED_BLOOM_AT = 10;    // of 14
const PROTECTED_LEAFY_AT = 4;
const MILESTONES = [7, 30, 100];  // protected days, lifetime

function dayState(day) {
  if (!day) return "quiet";
  const browsed = day.browsedMinutes || 0;

  const hasFields = day.passes !== undefined || day.pauses !== undefined || day.offs !== undefined;
  if (!hasFields) {
    // A day recorded before these counters existed. Its only "unclean" minutes came from
    // pass-throughs, so a dip in clean share is the legacy equivalent of a pass.
    if (browsed < PROTECTED_MIN_BROWSED) return "quiet";
    return cleanShare(day) >= 0.95 ? "protected" : "passed";
  }

  if ((day.passes || 0) > 0) return "passed";
  if ((day.pauses || 0) > 0 || (day.offs || 0) > 0) return "paused";
  return browsed >= PROTECTED_MIN_BROWSED ? "protected" : "quiet";
}

// "YYYY-MM-DD" local keys for the `days` days ending at `endKey`, oldest first.
function windowKeys(endKey, days = PROTECTION_WINDOW_DAYS) {
  const [y, m, d] = endKey.split("-").map(Number);
  const keys = [];
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(y, m - 1, d - i);
    keys.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`);
  }
  return keys;
}

function protectionWindow(history, today, todayKey, days = PROTECTION_WINDOW_DAYS) {
  const keys = windowKeys(todayKey, days);
  const states = keys.map((key) => dayState(key === todayKey ? today : (history || {})[key]));
  const count = (s) => states.filter((x) => x === s).length;
  return {
    keys,
    states,
    days,
    protected: count("protected"),
    passed: count("passed"),
    paused: count("paused"),
    quiet: count("quiet"),
  };
}

// The plant is the same number as the ring, in another shape.
function plantStage(protectedCount) {
  if (protectedCount >= PROTECTED_BLOOM_AT) return "bloom";
  if (protectedCount >= PROTECTED_LEAFY_AT) return "leafy";
  return "sprout";
}

// Longest run of protected days. Quiet days are skipped rather than breaking a run (no
// browsing is not a slip); passed and paused days end it. Only ever shown as a personal
// best, never as a counter that can be "lost".
function bestRun(history, today, todayKey) {
  const all = { ...(history || {}) };
  if (today && todayKey) all[todayKey] = today;
  let best = 0;
  let run = 0;
  for (const key of Object.keys(all).sort()) {
    const s = dayState(all[key]);
    if (s === "protected") { run += 1; best = Math.max(best, run); }
    else if (s !== "quiet") run = 0;
  }
  return best;
}

// Lifetime protected days. totals.closedDays only moves at the day rollover, so on its own
// it is always one behind the ring on a protected day: the ring said "protected today"
// while the count under it had not moved, and a milestone showed up a day late.
function lifetimeProtected(totals, today) {
  return ((totals || {}).closedDays || 0) + (dayState(today) === "protected" ? 1 : 0);
}

// Which lifetime milestones have been reached, e.g. [7, 30].
function reachedMilestones(protectedDaysTotal) {
  return MILESTONES.filter((n) => (protectedDaysTotal || 0) >= n);
}

// ── Mascot mood ───────────────────────────────────────────────────────────────
//
// A pure function from facts the extension already tracks to how the mascot looks. Five
// levels so progress is visible, plus a warm "encourage" after a slip. Nothing here is
// sad or guilt-inducing: the lowest-energy states are asleep (protection is off) and a
// calm default.
//   input: { off, state (dayState of today), protectedCount (of the last 14),
//            anyActive (any tracked day at all), milestoneToday }
// returns { level, pose, caption, label }
function mascotMood({ off, state, protectedCount, anyActive, milestoneToday }) {
  if (off) {
    return { level: "asleep", pose: "sleepy", caption: "Resting while protection is off.", label: "asleep" };
  }
  if (state === "passed" || state === "paused") {
    return { level: "warm", pose: "encourage", caption: "That happens. Tomorrow is a fresh page.", label: "warm and encouraging" };
  }
  if (!anyActive) {
    return { level: "hello", pose: "wave", caption: "Hi! I'll keep watch.", label: "waving hello" };
  }
  if (state === "protected" && (milestoneToday || protectedCount >= PROTECTED_BLOOM_AT)) {
    return { level: "celebrate", pose: "happy", caption: "Look at you. Protected day!", label: "celebrating" };
  }
  if (state === "protected" || protectedCount >= PROTECTED_LEAFY_AT) {
    return { level: "glad", pose: "happy", caption: state === "protected" ? "A good day so far." : "Going well. Nice.", label: "happy" };
  }
  return { level: "calm", pose: "default", caption: "Quiet day so far.", label: "calm" };
}

// Same mood the popup shows, from raw stored data. Used by the toolbar icon so the two
// can never disagree.
function moodFromData({ today, history, totals, enabled, disableUntil }, todayKey, now = Date.now()) {
  const win = protectionWindow(history || {}, today || {}, todayKey);
  const state = dayState(today);
  const off = enabled === false || Boolean(disableUntil && disableUntil > now);
  const mood = mascotMood({
    off,
    state,
    protectedCount: win.protected,
    anyActive: win.protected + win.passed + win.paused > 0,
    milestoneToday: state === "protected" && MILESTONES.includes(lifetimeProtected(totals, today)),
  });
  return { mood, protectedCount: win.protected, days: win.days };
}

// ── Quick pause ───────────────────────────────────────────────────────────────
//
// A cheap, short, rate-limited way to switch protection off, so that the only alternative
// to the long cooldown is not uninstalling. It never bypasses the lock: the same
// disablePermission() and partner gate apply (see popup.js).

const QUICK_PAUSE_MS = 10 * 60 * 1000;
const QUICK_PAUSE_LIMIT_PER_DAY = 3;
const QUICK_PAUSE_WINDOW_MS = 24 * 60 * 60 * 1000;
const QUICK_PAUSE_WAIT_S = 30;

function recentQuickPauses(events, now = Date.now()) {
  const cutoff = now - QUICK_PAUSE_WINDOW_MS;
  return (events || []).filter((ts) => typeof ts === "number" && ts > cutoff);
}

function quickPausesRemaining(events, now = Date.now()) {
  return Math.max(0, QUICK_PAUSE_LIMIT_PER_DAY - recentQuickPauses(events, now).length);
}

function recordQuickPause(events, now = Date.now()) {
  return [...recentQuickPauses(events, now), now];
}

// ── User blocklist ────────────────────────────────────────────────────────────
//
// Entries are { domain, addedAt }. A listed domain also blocks its subdomains
// (blocking example.com blocks m.example.com); the trust list stays exact-match, which is
// the conservative direction for the thing that turns scanning off.

function blockedEntryDomain(entry) {
  return normalizeDomain(typeof entry === "string" ? entry : entry?.domain);
}

function isUserBlocked(blockedSites, hostname) {
  const host = normalizeDomain(hostname);
  if (!host) return false;
  return (blockedSites || []).some((entry) => {
    const d = blockedEntryDomain(entry);
    return d && (host === d || host.endsWith(`.${d}`));
  });
}

// ── Weekly recap ──────────────────────────────────────────────────────────────

// Counts only. `reflections` is [{ ts, chip }], `history` the stored map.
function weeklyRecap(history, today, todayKey, reflections, now = Date.now()) {
  const win = protectionWindow(history, today, todayKey, 7);
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const recent = (reflections || []).filter((r) => r && r.ts > weekAgo);

  const chipCounts = {};
  const hourCounts = new Array(24).fill(0);
  for (const r of recent) {
    chipCounts[r.chip] = (chipCounts[r.chip] || 0) + 1;
    hourCounts[new Date(r.ts).getHours()] += 1;
  }
  const topChip = Object.entries(chipCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || null;
  const topHour = Math.max(...hourCounts) >= 2 ? hourCounts.indexOf(Math.max(...hourCounts)) : null;

  let pauses = 0;
  const all = { ...(history || {}), [todayKey]: today };
  for (const key of win.keys) pauses += (all[key]?.redirects || 0);

  return {
    protectedDays: win.protected,
    passedDays: win.passed,
    pausedDays: win.paused,
    pauses,
    reflections: recent.length,
    topChip,
    topHour,
  };
}
