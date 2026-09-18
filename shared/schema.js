const SCHEMA_VERSION = 2;

const HISTORY_MAX_DAYS = 365;
const REFLECTION_MAX = 1000;
const BLOCK_LOG_MAX = 25;
const MIN_BROWSED_FOR_CLOSE = 20; // minutes

// The ring's single source of truth. Used by the popup, the rollover and the heatmap so
// they cannot drift apart.
function cleanShare(day) {
  const browsed = day?.browsedMinutes || 0;
  if (!browsed) return 0;
  return Math.min(1, (day.cleanMinutes || 0) / browsed);
}

function ringIsClosed(day, shareGoal = 0.95) {
  return (day?.browsedMinutes || 0) >= MIN_BROWSED_FOR_CLOSE && cleanShare(day) >= shareGoal;
}

// `browsedMinutes` is recorded alongside `cleanMinutes` deliberately.
//
// cleanMinutes  — active minutes where the foreground tab was scanned and nothing flagged.
// browsedMinutes — active minutes where the foreground tab was scanned at all.
//
// Storing both keeps the open question in plan.md §9.1 ("the ring rewards more browsing")
// a presentation choice rather than a migration. A total-based ring reads cleanMinutes;
// a ratio-based ring reads cleanMinutes / browsedMinutes. Neither needs a schema change.
function getDefaultToday(dateStr) {
  return {
    date: dateStr,
    cleanMinutes: 0,
    browsedMinutes: 0,
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
    sensitivity: DEFAULT_SENSITIVITY,
    enableDwellDetection: false, // plan §8.8 asked for this flag; it shipped on instead
    // Gemini Nano second opinion. Off by default: it needs a multi-gigabyte model that
    // Chrome downloads on first use, and most machines do not meet its requirements.
    enableNanoAssist: false,
    onboardingCompleted: false,
    selfEstimateHours: null,
    // Which onboarding path was taken. "guardian" means someone set this up for another
    // person on this device, which changes what the popup emphasises and what the
    // onboarding recommended.
    setupMode: "self",
    // In-progress onboarding answers, so a mid-flow extension reload (granting incognito
    // access causes one) does not throw the user back to step one. Cleared on finish.
    onboardingDraft: null,

    // ── Lock strength (shared/lock.js) ──
    // Friction on turning CleanTab off. Deliberately separate from the per-page escape
    // hatches, which stay cheap: a hard lock over an unreliable detector is how a
    // blocker gets uninstalled after one misfire on a medical page.
    partnerLockHash: null,   // SHA-256 of a phrase a second person chose and keeps
    partnerLockLabel: null,  // who holds it, e.g. "Sam" — for the prompt only
    lockWindow: { enabled: false, startHour: 22, endHour: 6 },
    disableEvents: [],       // timestamps within the escalation window
    // "Let me through once" uses, per root domain, within a rolling day. Kept in local
    // storage because a count that resets on browser restart is not a limit.
    allowanceEvents: {},

    // The ring fills on clean SHARE, not on a minute total, so a short clean day closes
    // as well as a long one and shutting the laptop is not a penalty (plan §9.1). A floor
    // on browsed minutes stops one clean minute reading as a closed day.
    cleanShareGoal: 0.95,
    goalMinutes: 120, // retained: the onboarding estimate, and context under the ring

    // Trust list — records as of v2, migrated from v1's bare `safeDomains` strings
    trustedSites: [],

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

    // Recent blocks, for the popup's Sites tab. Domain + reason only — never the full
    // URL, which is the same reason the redirect page no longer carries one.
    blocks: [],
  };
}

function makeTrustEntry(domain, source, expiresAt = null) {
  return { domain: normalizeDomain(domain), addedAt: Date.now(), source, expiresAt };
}
