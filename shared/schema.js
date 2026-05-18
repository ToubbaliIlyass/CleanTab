const SCHEMA_VERSION = 1;

function getDefaultToday(dateStr) {
  return {
    date: dateStr,
    cleanMinutes: 0,
    redirects: 0,
    reflections: 0,
    ringClosedAt: null,
  };
}

function getDefaults(dateStr) {
  return {
    schemaVersion: SCHEMA_VERSION,

    // Settings
    enabled: true,
    disableUntil: null,
    cooldownUntil: null,
    safeDomains: [],
    onboardingCompleted: false,
    selfEstimateHours: null,
    goalMinutes: 120,

    // Today's counters
    today: getDefaultToday(dateStr),

    // Daily history (last 365 days)
    history: {},

    // Cumulative totals
    totals: {
      closedDays: 0,
      reflectionsLogged: 0,
      lifetimeCleanMinutes: 0,
    },

    // Reflection log (last 1000 entries)
    reflections: [],
  };
}
