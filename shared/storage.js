// Central storage module — all reads/writes go through here.
// Depends on: shared/schema.js, shared/dates.js, shared/migrations/v0_to_v1.js
// (Loaded via manifest content_scripts / background imports)

const HISTORY_MAX_DAYS = 365;
const REFLECTION_MAX = 1000;

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

// ─── Bootstrap & migration ────────────────────────────────────────────────────

async function bootstrap() {
  const raw = await storageGet(null);
  const dateStr = todayLocal();

  if (!raw.schemaVersion) {
    // First run or pre-v1 install — migrate legacy state then write defaults
    const migrated = migrateV0ToV1(raw, dateStr);
    await storageSet(migrated);

    // Remove old keys that no longer exist in v1
    const legacyKeys = [
      "streak", "lastStreakDay", "redirectsToday", "streakBrokenToday",
      "lastReset", "appealCooldowns",
    ];
    const toRemove = legacyKeys.filter((k) => k in raw);
    if (toRemove.length) await storageRemove(toRemove);

    return migrated;
  }

  // Future: if (raw.schemaVersion === 1) runV1ToV2(raw) etc.
  return raw;
}

// ─── Daily rollover ───────────────────────────────────────────────────────────

async function handleDailyRollover() {
  const data = await storageGet(["today", "totals", "history", "goalMinutes"]);
  const today = data.today || {};
  const dateStr = todayLocal();

  if (today.date === dateStr) return; // Already on today

  // Archive yesterday into history
  if (today.date) {
    const history = data.history || {};
    const goal = data.goalMinutes || 120;
    const ringClosed = today.ringClosedAt !== null || today.cleanMinutes >= goal;

    history[today.date] = {
      cleanMinutes: today.cleanMinutes || 0,
      goalMinutes: goal,
      redirects: today.redirects || 0,
      reflections: today.reflections || 0,
      ringClosed,
    };

    // Trim to last 365 days
    const keys = Object.keys(history).sort();
    while (keys.length > HISTORY_MAX_DAYS) {
      delete history[keys.shift()];
    }

    // Update cumulative totals
    const totals = data.totals || { closedDays: 0, reflectionsLogged: 0, lifetimeCleanMinutes: 0 };
    if (ringClosed) totals.closedDays += 1;
    totals.lifetimeCleanMinutes += today.cleanMinutes || 0;

    await storageSet({
      history,
      totals,
      today: getDefaultToday(dateStr),
    });
  } else {
    await storageSet({ today: getDefaultToday(dateStr) });
  }
}

// ─── Clean minute tracking ────────────────────────────────────────────────────

async function incrementCleanMinute() {
  const data = await storageGet(["today", "goalMinutes", "totals"]);
  const today = { ...data.today };
  const goal = data.goalMinutes || 120;

  today.cleanMinutes = (today.cleanMinutes || 0) + 1;

  const updates = { today };

  // Mark ring closed the first time we hit the goal
  if (!today.ringClosedAt && today.cleanMinutes >= goal) {
    today.ringClosedAt = Date.now();
    const totals = { ...(data.totals || {}) };
    // Note: closedDays is incremented at rollover, not here,
    // so we don't double-count.
    updates.totals = totals;
  }

  await storageSet(updates);
  return today;
}

// ─── Redirect recording ───────────────────────────────────────────────────────

async function recordRedirect() {
  const data = await storageGet(["today"]);
  const today = { ...data.today };
  today.redirects = (today.redirects || 0) + 1;
  await storageSet({ today });
}

// ─── Reflection recording ─────────────────────────────────────────────────────

async function recordReflection(chip, domain) {
  const data = await storageGet(["today", "totals", "reflections"]);

  const today = { ...data.today };
  today.reflections = (today.reflections || 0) + 1;

  const totals = { ...(data.totals || {}) };
  totals.reflectionsLogged = (totals.reflectionsLogged || 0) + 1;

  const reflections = [...(data.reflections || [])];
  reflections.push({ ts: Date.now(), chip, domain });

  // Cap at 1000 entries
  while (reflections.length > REFLECTION_MAX) reflections.shift();

  await storageSet({ today, totals, reflections });
  return totals.reflectionsLogged;
}

// ─── Safe domain management ───────────────────────────────────────────────────

async function addSafeDomain(domain) {
  const data = await storageGet(["safeDomains"]);
  const domains = data.safeDomains || [];
  if (!domains.includes(domain)) {
    domains.push(domain);
    await storageSet({ safeDomains: domains });
  }
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

  const recent = Object.values(history)
    .slice(-30)
    .map((d) => d.cleanMinutes || 0)
    .sort((a, b) => a - b);

  if (recent.length < 7) return; // Not enough data yet

  const median = recent[Math.floor(recent.length / 2)];
  const targetGoal = Math.min(240, Math.max(60, Math.round(median * 0.7)));

  // Blend: move 20% toward the new target
  const blended = Math.round(currentGoal + (targetGoal - currentGoal) * 0.2);
  await storageSet({ goalMinutes: blended });
}

// ─── Full state read (for popup / export) ─────────────────────────────────────

async function getFullState() {
  return storageGet(null);
}
