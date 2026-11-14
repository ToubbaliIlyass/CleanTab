// Focus mode — block streaming and endless feeds for a stretch of time.
//
// Pure functions: no storage, no chrome.*, testable in Node. The worker decides, the
// content script acts, exactly as with the adult-site list.
//
// Focus is an extra layer on top of protection, never a replacement for it:
//   - protection stays on for as long as focus is on. Starting focus ends any pause, and
//     protection cannot be paused or disabled until focus is over;
//   - a focus block is never a "slip". It does not touch dayState(), the ring or the
//     protected-days count, and it is not written to the block log;
//   - trusting a site (which only means "do not scan it") does not exempt it from focus.
//
// Two ways to be focusing:
//   session   started by hand for a number of minutes
//   schedule  hours and weekdays chosen in advance
// Either can be ended early after a short breather (popup), and any blocked site can be
// opened for five minutes a few times a day, because the list will be wrong about what
// someone needs for work.

// An entry is a domain ("netflix.com", subdomains included) or a domain plus a path
// prefix ("youtube.com/shorts").
const FOCUS_CATEGORIES = {
  streaming: {
    label: "Streaming",
    blurb: "Netflix, YouTube, Twitch, Prime Video, Disney+ and the like.",
    sites: [
      "netflix.com", "youtube.com", "twitch.tv", "primevideo.com", "amazon.com/gp/video",
      "disneyplus.com", "hulu.com", "max.com", "hbomax.com", "crunchyroll.com",
      "tv.apple.com", "peacocktv.com", "paramountplus.com", "dailymotion.com", "kick.com",
      "shahid.mbc.net", "bilibili.com", "pluto.tv", "tubitv.com",
    ],
  },
  feeds: {
    label: "Doom scrolling",
    blurb: "TikTok, Instagram, X, Reddit, Facebook, and short-video feeds.",
    sites: [
      "tiktok.com", "instagram.com", "facebook.com", "x.com", "twitter.com", "reddit.com",
      "threads.net", "threads.com", "snapchat.com", "pinterest.com", "tumblr.com",
      "9gag.com", "bsky.app", "imgur.com", "linkedin.com/feed",
      "youtube.com/shorts",
    ],
  },
};

// Parts of a listed site that are tools rather than entertainment.
const FOCUS_EXCEPTIONS = ["music.youtube.com", "studio.youtube.com", "business.facebook.com"];

const FOCUS_DURATIONS = [25, 50, 90]; // minutes
const FOCUS_MAX_MINUTES = 8 * 60;
const FOCUS_PASS_MS = 5 * 60 * 1000;
const FOCUS_END_WAIT_S = 30;

const FOCUS_DEFAULTS = {
  categories: { streaming: true, feeds: true },
  // "I watch tutorials": leaves YouTube open during focus. Shorts stay blocked while
  // doom scrolling is on, because nobody learns from Shorts.
  keepYouTube: false,
  sites: [], // the user's own additions, bare domains
  schedule: { enabled: false, days: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 },
};

// Stored settings merged over the defaults, so a profile written by an older version (or
// never written at all) always has every field.
function focusSettings(stored) {
  const s = stored || {};
  return {
    categories: { ...FOCUS_DEFAULTS.categories, ...(s.categories || {}) },
    keepYouTube: Boolean(s.keepYouTube),
    sites: Array.isArray(s.sites) ? s.sites.map(normalizeDomain).filter(Boolean) : [],
    schedule: { ...FOCUS_DEFAULTS.schedule, ...(s.schedule || {}) },
  };
}

// ── Matching ──────────────────────────────────────────────────────────────────

function focusEntryMatches(entry, host, pathname) {
  const slash = entry.indexOf("/");
  const domain = slash === -1 ? entry : entry.slice(0, slash);
  const prefix = slash === -1 ? "" : entry.slice(slash);
  if (host !== domain && !host.endsWith(`.${domain}`)) return false;
  if (!prefix) return true;
  return pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(`${prefix}?`);
}

// Which rule, if any, puts this URL off-limits during focus.
// Returns { category, label } or null.
function focusMatch(url, stored) {
  let host, pathname;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    host = normalizeDomain(u.hostname);
    pathname = u.pathname || "/";
  } catch {
    return null;
  }
  const settings = focusSettings(stored);

  // The user's own list is the most specific statement of intent, so it is checked first
  // and nothing exempts it.
  if (settings.sites.some((d) => host === d || host.endsWith(`.${d}`))) {
    return { category: "custom", label: "your focus list" };
  }

  if (FOCUS_EXCEPTIONS.some((d) => host === d || host.endsWith(`.${d}`))) return null;

  for (const key of ["feeds", "streaming"]) {
    if (!settings.categories[key]) continue;
    for (const entry of FOCUS_CATEGORIES[key].sites) {
      if (!focusEntryMatches(entry, host, pathname)) continue;
      if (settings.keepYouTube && entry === "youtube.com") continue;
      return { category: key, label: FOCUS_CATEGORIES[key].label.toLowerCase() };
    }
  }
  return null;
}

// ── When ──────────────────────────────────────────────────────────────────────

function validHour(h) {
  const n = Number(h);
  return Number.isInteger(n) && n >= 0 && n <= 23;
}

// The scheduled window that contains `now`, as { start, end } timestamps, or null.
// A window like 22 → 6 wraps past midnight and belongs to the day it started on.
function scheduleWindowAt(schedule, now = Date.now()) {
  if (!schedule?.enabled) return null;
  const { startHour, endHour } = schedule;
  if (!validHour(startHour) || !validHour(endHour) || Number(startHour) === Number(endHour)) return null;
  const days = Array.isArray(schedule.days) ? schedule.days : [];
  const wraps = Number(startHour) > Number(endHour);

  const d = new Date(now);
  // Try the window that started today, then the one that started yesterday (wrapping).
  for (const back of [0, 1]) {
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, Number(startHour));
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back + (wraps ? 1 : 0), Number(endHour));
    if (!days.includes(start.getDay())) continue;
    if (now >= start.getTime() && now < end.getTime()) return { start: start.getTime(), end: end.getTime() };
  }
  return null;
}

// When the next scheduled window opens, or null.
function nextScheduleStart(schedule, now = Date.now()) {
  if (!schedule?.enabled) return null;
  const { startHour, endHour } = schedule;
  if (!validHour(startHour) || !validHour(endHour) || Number(startHour) === Number(endHour)) return null;
  const days = Array.isArray(schedule.days) ? schedule.days : [];
  const d = new Date(now);
  for (let i = 0; i <= 7; i++) {
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, Number(startHour));
    if (start.getTime() > now && days.includes(start.getDay())) return start.getTime();
  }
  return null;
}

// The single answer to "is focus on right now, why, until when, and when should a page
// ask again". `state` is { focus, focusSession, focusSkipUntil } as stored.
function focusStatus(state, now = Date.now()) {
  const settings = focusSettings(state?.focus);
  const session = state?.focusSession;
  const sessionUntil = session?.until && session.until > now ? session.until : null;

  const skipping = Boolean(state?.focusSkipUntil && state.focusSkipUntil > now);
  const win = skipping ? null : scheduleWindowAt(settings.schedule, now);

  if (sessionUntil || win) {
    const until = Math.max(sessionUntil || 0, win ? win.end : 0);
    return {
      active: true,
      source: sessionUntil ? "session" : "schedule",
      startedAt: sessionUntil ? (session.startedAt || now) : win.start,
      until,
      nextChange: until,
    };
  }

  const candidates = [
    nextScheduleStart(settings.schedule, now),
    skipping ? state.focusSkipUntil : null,
  ].filter((t) => t && t > now);
  return {
    active: false,
    source: null,
    startedAt: null,
    until: null,
    nextChange: candidates.length ? Math.min(...candidates) : null,
  };
}

// Ending early: a session simply stops; a scheduled window is skipped until it would have
// ended. Returns the storage updates to apply.
function focusEndEarly(state, now = Date.now()) {
  const settings = focusSettings(state?.focus);
  const updates = { focusSession: null };
  const win = scheduleWindowAt(settings.schedule, now);
  if (win) updates.focusSkipUntil = win.end;
  return updates;
}

function focusClampMinutes(minutes) {
  const n = Math.round(Number(minutes));
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(n, FOCUS_MAX_MINUTES);
}

// ── Words ─────────────────────────────────────────────────────────────────────

// "32 min", "1 h 5 min". Rounded up, so the last minute never reads as "0 min".
function focusRemainingText(ms) {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// For the toolbar badge, which fits about four characters.
function focusBadgeText(ms) {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  if (mins < 100) return `${mins}m`;
  return `${Math.round(mins / 60)}h`;
}

function focusClockText(ts) {
  const d = new Date(ts);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const suffix = h < 12 ? "am" : "pm";
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${suffix}`;
}

function focusMinutesText(mins) {
  const n = Math.max(0, Math.round(mins || 0));
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// Total focus minutes over the last `days` days, today included.
function focusMinutesInWindow(history, today, todayKey, days = 7) {
  let total = 0;
  for (const key of windowKeys(todayKey, days)) {
    const day = key === todayKey ? today : (history || {})[key];
    total += (day && day.focusMinutes) || 0;
  }
  return total;
}
