import { createEnv, makeTester, eq, ok, notOk } from "./harness.mjs";

// Local-time helper: the schedule is defined in the user's own hours.
const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime();

export default async function () {
  const t = makeTester("focus mode");
  const e = createEnv({ now: at(2026, 9, 16, 12) }); // a Wednesday, noon
  const run = (src) => e.run(src);
  const set = (name, value) => { e.ctx[name] = value; };

  // ── What closes ────────────────────────────────────────────────────────────
  t("streaming and feed sites match by default", () => {
    eq(run(`focusMatch("https://www.netflix.com/browse", null).category`), "streaming");
    eq(run(`focusMatch("https://www.youtube.com/watch?v=1", null).category`), "streaming");
    eq(run(`focusMatch("https://old.reddit.com/r/all", null).category`), "feeds");
    eq(run(`focusMatch("https://x.com/home", null).category`), "feeds");
  });
  t("ordinary sites, and non-web pages, never match", () => {
    eq(run(`focusMatch("https://docs.google.com/document/d/1", null)`), null);
    eq(run(`focusMatch("https://github.com/", null)`), null);
    eq(run(`focusMatch("chrome://extensions", null)`), null);
    eq(run(`focusMatch("not a url", null)`), null);
  });
  t("a lookalike domain is not a listed site", () => {
    eq(run(`focusMatch("https://notnetflix.com/", null)`), null);
    eq(run(`focusMatch("https://netflix.com.example.org/", null)`), null);
  });
  t("path rules only match that part of the site", () => {
    eq(run(`focusMatch("https://www.linkedin.com/feed/", null).category`), "feeds");
    eq(run(`focusMatch("https://www.linkedin.com/messaging/", null)`), null);
    eq(run(`focusMatch("https://www.linkedin.com/feedback", null)`), null);
    eq(run(`focusMatch("https://www.amazon.com/gp/video/storefront", null).category`), "streaming");
    eq(run(`focusMatch("https://www.amazon.com/dp/B000", null)`), null);
  });
  t("tools on a listed domain stay open", () => {
    eq(run(`focusMatch("https://music.youtube.com/", null)`), null);
    eq(run(`focusMatch("https://studio.youtube.com/channel/1", null)`), null);
  });
  t("a category switched off stops matching", () => {
    set("__s", { categories: { streaming: false, feeds: true } });
    eq(run(`focusMatch("https://www.netflix.com/", __s)`), null);
    eq(run(`focusMatch("https://www.tiktok.com/", __s).category`), "feeds");
  });
  t("keeping YouTube leaves videos open and Shorts closed", () => {
    set("__s", { keepYouTube: true });
    eq(run(`focusMatch("https://www.youtube.com/watch?v=1", __s)`), null);
    eq(run(`focusMatch("https://www.youtube.com/shorts/abc", __s).category`), "feeds");
    eq(run(`focusMatch("https://www.netflix.com/", __s).category`), "streaming");
  });
  t("keeping YouTube with doom scrolling off opens Shorts too", () => {
    set("__s", { keepYouTube: true, categories: { feeds: false } });
    eq(run(`focusMatch("https://www.youtube.com/shorts/abc", __s)`), null);
  });
  t("the user's own list matches, subdomains included, and beats the exceptions", () => {
    set("__s", { sites: ["news.example.com", "music.youtube.com"], categories: { streaming: false, feeds: false } });
    eq(run(`focusMatch("https://news.example.com/world", __s).category`), "custom");
    eq(run(`focusMatch("https://live.news.example.com/", __s).category`), "custom");
    eq(run(`focusMatch("https://example.com/", __s)`), null);
    eq(run(`focusMatch("https://music.youtube.com/", __s).category`), "custom");
  });
  t("settings written by an older version still get every field", () => {
    const s = run(`focusSettings({ sites: ["WWW.Example.com", ""] })`);
    eq(s.categories, { streaming: true, feeds: true });
    eq(s.sites, ["example.com"]);
    eq(s.schedule.enabled, false);
  });

  // ── When ──────────────────────────────────────────────────────────────────
  t("nothing set means focus is off, with nothing to wait for", () => {
    const s = run(`focusStatus({})`);
    notOk(s.active);
    eq(s.nextChange, null);
  });
  t("a running session is active until it ends", () => {
    set("__st", { focusSession: { startedAt: at(2026, 9, 16, 11, 50), until: at(2026, 9, 16, 12, 15) } });
    const s = run(`focusStatus(__st)`);
    ok(s.active);
    eq(s.source, "session");
    eq(s.until, at(2026, 9, 16, 12, 15));
    eq(s.nextChange, s.until);
  });
  t("a finished session is not active", () => {
    set("__st", { focusSession: { startedAt: 1, until: at(2026, 9, 16, 11, 59) } });
    notOk(run(`focusStatus(__st)`).active);
  });
  t("a schedule is active inside its hours on its days", () => {
    set("__st", { focus: { schedule: { enabled: true, days: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 } } });
    const s = run(`focusStatus(__st)`);
    ok(s.active);
    eq(s.source, "schedule");
    eq(s.until, at(2026, 9, 16, 17));
  });
  t("outside its hours it says when it next starts", () => {
    set("__st", { focus: { schedule: { enabled: true, days: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 } } });
    set("__now", at(2026, 9, 16, 18));
    const s = run(`focusStatus(__st, __now)`);
    notOk(s.active);
    eq(s.nextChange, at(2026, 9, 17, 9));
  });
  t("a day that is not ticked is skipped", () => {
    set("__st", { focus: { schedule: { enabled: true, days: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 } } });
    set("__now", at(2026, 9, 19, 12)); // Saturday
    const s = run(`focusStatus(__st, __now)`);
    notOk(s.active);
    eq(s.nextChange, at(2026, 9, 21, 9)); // Monday
  });
  t("a window that wraps past midnight belongs to the day it started", () => {
    set("__st", { focus: { schedule: { enabled: true, days: [5], startHour: 22, endHour: 2 } } }); // Friday night
    set("__now", at(2026, 9, 19, 1)); // 1am Saturday
    ok(run(`focusStatus(__st, __now)`).active, "Friday's window is still running");
    set("__now", at(2026, 9, 20, 1)); // 1am Sunday
    notOk(run(`focusStatus(__st, __now)`).active, "Saturday was not ticked");
  });
  t("a schedule with no days, or equal hours, never starts", () => {
    set("__st", { focus: { schedule: { enabled: true, days: [], startHour: 9, endHour: 17 } } });
    notOk(run(`focusStatus(__st)`).active);
    set("__st", { focus: { schedule: { enabled: true, days: [3], startHour: 9, endHour: 9 } } });
    notOk(run(`focusStatus(__st)`).active);
  });
  t("a session running past the schedule's end keeps focus on until the later one", () => {
    set("__st", {
      focus: { schedule: { enabled: true, days: [3], startHour: 9, endHour: 13 } },
      focusSession: { startedAt: at(2026, 9, 16, 11), until: at(2026, 9, 16, 14) },
    });
    eq(run(`focusStatus(__st)`).until, at(2026, 9, 16, 14));
  });

  // ── Ending early ──────────────────────────────────────────────────────────
  t("ending a session early clears it", () => {
    set("__st", { focusSession: { startedAt: 1, until: at(2026, 9, 16, 13) } });
    eq(run(`focusEndEarly(__st)`), { focusSession: null });
  });
  t("ending a scheduled window early skips the rest of it, and only it", () => {
    set("__st", { focus: { schedule: { enabled: true, days: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 } } });
    const updates = run(`focusEndEarly(__st)`);
    eq(updates.focusSkipUntil, at(2026, 9, 16, 17));
    set("__st2", { ...e.ctx.__st, ...updates });
    notOk(run(`focusStatus(__st2)`).active, "skipped for today");
    eq(run(`focusStatus(__st2)`).nextChange, at(2026, 9, 16, 17));
    set("__now", at(2026, 9, 17, 10));
    ok(run(`focusStatus(__st2, __now)`).active, "back on tomorrow");
  });

  // ── Words and numbers ─────────────────────────────────────────────────────
  t("minutes are clamped to something sane", () => {
    eq(run(`focusClampMinutes("40")`), 40);
    eq(run(`focusClampMinutes(0)`), null);
    eq(run(`focusClampMinutes("abc")`), null);
    eq(run(`focusClampMinutes(100000)`), 480);
  });
  t("time left never reads as zero", () => {
    eq(run(`focusRemainingText(20 * 1000)`), "1 min");
    eq(run(`focusRemainingText(32 * 60000)`), "32 min");
    eq(run(`focusRemainingText(65 * 60000)`), "1 h 5 min");
    eq(run(`focusBadgeText(25 * 60000)`), "25m");
    eq(run(`focusBadgeText(180 * 60000)`), "3h");
  });
  t("focus minutes add up across the week", () => {
    set("__h", { "2026-09-15": { focusMinutes: 50 }, "2026-09-10": { focusMinutes: 25 }, "2026-09-01": { focusMinutes: 90 } });
    eq(run(`focusMinutesInWindow(__h, { focusMinutes: 20 }, "2026-09-16", 7)`), 95);
  });

  // ── Focus never touches the protected-days count ──────────────────────────
  t("focus counters do not change a day's state", () => {
    eq(run(`dayState({ browsedMinutes: 30, passes: 0, pauses: 0, offs: 0, focusBlocks: 9, focusMinutes: 120 })`), "protected");
  });
  await t("recording a focus block leaves the pause count alone", async () => {
    await e.runAsync(`await bootstrap(); await recordDayEvent("focusBlocks");`);
    const today = e.local._store.today;
    eq(today.focusBlocks, 1);
    eq(today.redirects || 0, 0);
    eq(today.passes || 0, 0);
  });

  return t;
}
