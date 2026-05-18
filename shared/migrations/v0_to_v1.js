// Migrates the v0 flat key structure (streak, lastStreakDay, redirectsToday, etc.)
// into the v1 schema (today, history, totals, reflections).
function migrateV0ToV1(existing, dateStr) {
  const redirectsToday = existing.redirectsToday || 0;
  const streak = existing.streak || 1;

  const today = {
    date: dateStr,
    cleanMinutes: 0,
    redirects: redirectsToday,
    reflections: 0,
    ringClosedAt: null,
  };

  // Carry forward any safe domains
  const safeDomains = existing.safeDomains || [];

  // Map old streak to closed days (approximation — we can't recover history)
  const closedDays = Math.max(0, streak - 1);

  const totals = {
    closedDays,
    reflectionsLogged: 0,
    lifetimeCleanMinutes: 0,
  };

  return {
    schemaVersion: 1,
    enabled: existing.enabled !== false,
    disableUntil: existing.disableUntil || null,
    cooldownUntil: existing.cooldownUntil || null,
    safeDomains,
    onboardingCompleted: false,
    selfEstimateHours: null,
    goalMinutes: 120,
    today,
    history: {},
    totals,
    reflections: [],
  };
}
