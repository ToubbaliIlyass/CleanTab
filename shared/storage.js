// Central storage module — all reads/writes go through here.
//
// Load order matters; these are plain globals, not ES modules (the project has no build
// step, and adding one to ship a 300-line storage layer isn't worth it):
//   shared/dates.js, shared/domains.js, shared/thresholds.js, shared/schema.js,
//   shared/migrations/*.js, then this file.

// ─── Low-level helpers ────────────────────────────────────────────────────────

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(updates) {
  return new Promise((resolve) => chrome.storage.local.set(updates, resolve));
}

function storageRemove(keys) {
  return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
}

// Session storage is cleared when the browser closes and is not exposed to content
// scripts. It holds anything we deliberately do not want to persist: per-tab scan
// verdicts, the URL a tab was redirected away from, and temporary allowances.
function sessionGet(keys) {
  return new Promise((resolve) => chrome.storage.session.get(keys, resolve));
}

function sessionSet(updates) {
  return new Promise((resolve) => chrome.storage.session.set(updates, resolve));
}

function sessionRemove(keys) {
  return new Promise((resolve) => chrome.storage.session.remove(keys, resolve));
}

// ─── Bootstrap & migration ────────────────────────────────────────────────────

async function bootstrap() {
  const raw = await storageGet(null);
  const dateStr = todayLocal();

  let state = raw;

  if (!state.schemaVersion) {
    state = migrateV0ToV1(state, dateStr);
    const legacyKeys = [
      "streak", "lastStreakDay", "redirectsToday", "streakBrokenToday",
      "lastReset", "appealCooldowns",
    ];
    const toRemove = legacyKeys.filter((k) => k in raw);
    if (toRemove.length) await storageRemove(toRemove);
  }

  if (state.schemaVersion === 1) {
    state = migrateV1ToV2(state);
    await storageSet(state);
    if ("safeDomains" in state) await storageRemove(["safeDomains"]);
  }

  // Backfill any key a partially-written profile is missing, without clobbering values.
  const defaults = getDefaults(dateStr);
  const missing = {};
  for (const [k, v] of Object.entries(defaults)) {
    if (state[k] === undefined) missing[k] = v;
  }
  if (Object.keys(missing).length) {
    await storageSet(missing);
    state = { ...state, ...missing };
  }

  return state;
}

// ─── Daily rollover ───────────────────────────────────────────────────────────

async function handleDailyRollover() {
  const data = await storageGet(["today", "totals", "history", "goalMinutes", "cleanShareGoal"]);
  const today = data.today || {};
  const dateStr = todayLocal();

  if (today.date === dateStr) return;

  if (!today.date) {
    await storageSet({ today: getDefaultToday(dateStr) });
    return;
  }

  const history = data.history || {};
  const goal = data.goalMinutes || 120;
  const shareGoal = data.cleanShareGoal ?? 0.95;
  const ringClosed = ringIsClosed(today, shareGoal);

  history[today.date] = {
    cleanMinutes: today.cleanMinutes || 0,
    browsedMinutes: today.browsedMinutes || 0,
    cleanShare: cleanShare(today),
    goalMinutes: goal,
    cleanShareGoal: shareGoal,
    redirects: today.redirects || 0,
    reflections: today.reflections || 0,
    ringClosed,
  };

  const keys = Object.keys(history).sort();
  while (keys.length > HISTORY_MAX_DAYS) delete history[keys.shift()];

  const totals = data.totals || { closedDays: 0, reflectionsLogged: 0, lifetimeCleanMinutes: 0 };
  if (ringClosed) totals.closedDays = (totals.closedDays || 0) + 1;
  totals.lifetimeCleanMinutes = (totals.lifetimeCleanMinutes || 0) + (today.cleanMinutes || 0);

  await storageSet({ history, totals, today: getDefaultToday(dateStr) });
}

// ─── Minute tracking ──────────────────────────────────────────────────────────

// `clean` is the foreground tab's most recent scan verdict. Both counters advance on a
// scanned tab; only cleanMinutes advances when nothing was flagged. A tab we could not
// scan (chrome://, the PDF viewer, a restricted page) advances neither — it is neutral,
// not virtuous, and counting it was the reason the old metric meant nothing.
async function tickMinute(clean) {
  const data = await storageGet(["today", "cleanShareGoal"]);
  const today = { ...(data.today || {}) };
  const shareGoal = data.cleanShareGoal ?? 0.95;

  today.browsedMinutes = (today.browsedMinutes || 0) + 1;
  if (clean) today.cleanMinutes = (today.cleanMinutes || 0) + 1;

  // ringClosedAt records when the ring FIRST closed. The share can dip below the goal
  // again after a later block; the day still counts as closed, matching how the old
  // minute-total ring behaved once it was full.
  if (!today.ringClosedAt && ringIsClosed(today, shareGoal)) {
    today.ringClosedAt = Date.now();
  }

  await storageSet({ today });
  return today;
}

// ─── Redirect / block log ─────────────────────────────────────────────────────

async function recordBlock(domain, reason) {
  const data = await storageGet(["today", "blocks"]);

  const today = { ...(data.today || {}) };
  today.redirects = (today.redirects || 0) + 1;

  const blocks = [...(data.blocks || [])];
  blocks.unshift({ ts: Date.now(), domain: normalizeDomain(domain), reason });
  while (blocks.length > BLOCK_LOG_MAX) blocks.pop();

  await storageSet({ today, blocks });
}

// ─── Reflection recording ─────────────────────────────────────────────────────

async function recordReflection(chip, domain) {
  const data = await storageGet(["today", "totals", "reflections"]);

  const today = { ...(data.today || {}) };
  today.reflections = (today.reflections || 0) + 1;

  const totals = { ...(data.totals || {}) };
  totals.reflectionsLogged = (totals.reflectionsLogged || 0) + 1;

  const reflections = [...(data.reflections || [])];
  reflections.push({ ts: Date.now(), chip, domain: normalizeDomain(domain) });
  while (reflections.length > REFLECTION_MAX) reflections.shift();

  await storageSet({ today, totals, reflections });
  return totals.reflectionsLogged;
}

// ─── Trust management ─────────────────────────────────────────────────────────

async function addTrustedSite(domain, source = "manual") {
  const norm = normalizeDomain(domain);
  if (!norm) return false;
  const data = await storageGet(["trustedSites"]);
  const sites = data.trustedSites || [];
  if (sites.some((e) => trustEntryDomain(e) === norm)) return false;
  sites.push(makeTrustEntry(norm, source));
  await storageSet({ trustedSites: sites });
  return true;
}

async function removeTrustedSite(domain) {
  const norm = normalizeDomain(domain);
  const data = await storageGet(["trustedSites"]);
  const sites = (data.trustedSites || []).filter((e) => trustEntryDomain(e) !== norm);
  await storageSet({ trustedSites: sites });
}

// ─── Temporary allowances (session-only) ──────────────────────────────────────
//
// "Let me through once" — the common response to a false positive. Scoped to one URL,
// time-boxed, and gone when the browser closes. A permanent domain-wide whitelist was
// the heaviest possible answer to "this one page was wrong".

const ALLOWANCE_KEY = "urlAllowances";
const ALLOWANCE_MS = 10 * 60 * 1000;

async function grantAllowance(url, ms = ALLOWANCE_MS) {
  const data = await sessionGet([ALLOWANCE_KEY]);
  const allowances = data[ALLOWANCE_KEY] || {};
  allowances[url] = Date.now() + ms;
  await sessionSet({ [ALLOWANCE_KEY]: allowances });
}

async function hasAllowance(url) {
  const data = await sessionGet([ALLOWANCE_KEY]);
  const allowances = data[ALLOWANCE_KEY] || {};
  const until = allowances[url];
  return Boolean(until && until > Date.now());
}

// ─── Per-site pause (session-only) ────────────────────────────────────────────

const SITE_PAUSE_KEY = "sitePauses";

async function pauseSite(domain, ms) {
  const norm = normalizeDomain(domain);
  const data = await sessionGet([SITE_PAUSE_KEY]);
  const pauses = data[SITE_PAUSE_KEY] || {};
  pauses[norm] = Date.now() + ms;
  await sessionSet({ [SITE_PAUSE_KEY]: pauses });
}

async function getSitePause(domain) {
  const norm = normalizeDomain(domain);
  const data = await sessionGet([SITE_PAUSE_KEY]);
  const until = (data[SITE_PAUSE_KEY] || {})[norm];
  return until && until > Date.now() ? until : null;
}

async function clearSitePause(domain) {
  const norm = normalizeDomain(domain);
  const data = await sessionGet([SITE_PAUSE_KEY]);
  const pauses = data[SITE_PAUSE_KEY] || {};
  delete pauses[norm];
  await sessionSet({ [SITE_PAUSE_KEY]: pauses });
}

// ─── Goal calibration ─────────────────────────────────────────────────────────

function computeInitialGoal(selfEstimateHours) {
  const raw = Math.round(selfEstimateHours * 60 * 0.7);
  return Math.min(240, Math.max(60, raw));
}

async function recalibrateGoal() {
  const data = await storageGet(["history", "goalMinutes"]);
  const history = data.history || {};
  const currentGoal = data.goalMinutes || 120;

  // Sort by date first — Object.values() order is insertion order, so the old
  // .slice(-30) was taking whichever 30 days happened to be written last.
  const recent = Object.keys(history)
    .sort()
    .slice(-30)
    .map((k) => history[k].cleanMinutes || 0)
    .sort((a, b) => a - b);

  if (recent.length < 7) return;

  const median = recent[Math.floor(recent.length / 2)];
  const targetGoal = Math.min(240, Math.max(60, Math.round(median * 0.7)));
  const blended = Math.round(currentGoal + (targetGoal - currentGoal) * 0.2);
  await storageSet({ goalMinutes: blended });
}

// ─── Sensitivity ──────────────────────────────────────────────────────────────

async function getSensitivityProfile() {
  const data = await storageGet(["sensitivity"]);
  return getProfile(data.sensitivity);
}
