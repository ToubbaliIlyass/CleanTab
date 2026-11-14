import { createEnv, makeTester, eq, ok } from "./harness.mjs";

// The accounting behind "N of the last 14 days protected": things that used to be written
// into the wrong day, or not counted at all.
export default async function () {
  const t = makeTester("protected-day accounting");
  const day = (iso) => Date.parse(iso);

  await t("a minute after midnight lands in the new day, not yesterday", async () => {
    const e = createEnv({ now: day("2026-09-16T23:50:00") });
    await e.runAsync(`await bootstrap(); for (let i = 0; i < 12; i++) await tickMinute(true);`);
    e.clock.set(day("2026-09-17T00:05:00"));
    await e.runAsync(`await tickMinute(true);`);
    eq(e.local._store.today.date, "2026-09-17");
    eq(e.local._store.today.browsedMinutes, 1);
    eq(e.local._store.history["2026-09-16"].browsedMinutes, 12);
    eq(e.local._store.history["2026-09-16"].state, "protected");
  });

  await t("a pass-through after midnight does not spoil yesterday", async () => {
    const e = createEnv({ now: day("2026-09-16T22:00:00") });
    await e.runAsync(`await bootstrap(); for (let i = 0; i < 12; i++) await tickMinute(true);`);
    e.clock.set(day("2026-09-17T00:10:00"));
    await e.runAsync(`await recordDayEvent("passes");`);
    eq(e.local._store.history["2026-09-16"].state, "protected");
    eq(e.local._store.today.passes, 1);
    eq(e.local._store.today.date, "2026-09-17");
  });

  await t("a block and a reflection after midnight are counted today", async () => {
    const e = createEnv({ now: day("2026-09-16T22:00:00") });
    await e.runAsync(`await bootstrap(); await recordBlock("example.com", "x");`);
    e.clock.set(day("2026-09-17T00:10:00"));
    await e.runAsync(`await recordBlock("example.com", "x"); await recordReflection("bored", "example.com");`);
    eq(e.local._store.history["2026-09-16"].redirects, 1);
    eq(e.local._store.today.redirects, 1);
    eq(e.local._store.today.reflections, 1);
  });

  await t("protection still off at midnight marks the new day too", async () => {
    const e = createEnv({ now: day("2026-09-16T23:55:00") });
    await e.runAsync(`await bootstrap();`);
    e.local._store.enabled = false;
    e.local._store.disableUntil = day("2026-09-17T00:20:00");
    e.clock.set(day("2026-09-17T00:01:00"));
    await e.runAsync(`await handleDailyRollover();`);
    eq(e.run(`dayState(${JSON.stringify(e.local._store.today)})`), "paused");
  });

  await t("a pause that ended before midnight does not carry over", async () => {
    const e = createEnv({ now: day("2026-09-16T23:00:00") });
    await e.runAsync(`await bootstrap();`);
    e.local._store.enabled = false;
    e.local._store.disableUntil = day("2026-09-16T23:30:00");
    e.clock.set(day("2026-09-17T00:01:00"));
    await e.runAsync(`await handleDailyRollover();`);
    eq(e.local._store.today.offs, 0);
  });

  await t("the clock going backwards keeps the day instead of overwriting history", async () => {
    const e = createEnv({ now: day("2026-09-17T08:00:00") });
    await e.runAsync(`await bootstrap(); for (let i = 0; i < 15; i++) await tickMinute(true);`);
    e.clock.set(day("2026-09-16T20:00:00"));
    await e.runAsync(`await tickMinute(true);`);
    eq(e.local._store.today.date, "2026-09-17");
    eq(e.local._store.today.browsedMinutes, 16);
    eq(Object.keys(e.local._store.history).length, 0);
  });

  await t("focus minutes are archived with the day", async () => {
    const e = createEnv({ now: day("2026-09-16T10:00:00") });
    await e.runAsync(`await bootstrap(); for (let i = 0; i < 25; i++) await recordDayEvent("focusMinutes");`);
    e.clock.set(day("2026-09-17T09:00:00"));
    await e.runAsync(`await handleDailyRollover();`);
    eq(e.local._store.history["2026-09-16"].focusMinutes, 25);
    eq(e.local._store.today.focusMinutes, 0);
  });

  // ── The lifetime count and its milestones ─────────────────────────────────
  const e = createEnv();
  t("a protected today is part of the lifetime count", () => {
    eq(e.run(`lifetimeProtected({ closedDays: 6 }, { browsedMinutes: 30, passes: 0, pauses: 0, offs: 0 })`), 7);
    eq(e.run(`lifetimeProtected({ closedDays: 6 }, { browsedMinutes: 30, passes: 1, pauses: 0, offs: 0 })`), 6);
    eq(e.run(`lifetimeProtected({ closedDays: 6 }, { browsedMinutes: 2, passes: 0, pauses: 0, offs: 0 })`), 6);
    eq(e.run(`lifetimeProtected(undefined, undefined)`), 0);
  });
  t("the 7-day milestone is celebrated on the 7th protected day, not the 8th", () => {
    const today = `{ browsedMinutes: 30, passes: 0, pauses: 0, offs: 0 }`;
    const on7th = e.run(`moodFromData({ today: ${today}, history: {}, totals: { closedDays: 6 }, enabled: true }, "2026-09-16").mood.level`);
    eq(on7th, "celebrate");
    const on8th = e.run(`moodFromData({ today: ${today}, history: {}, totals: { closedDays: 7 }, enabled: true }, "2026-09-16").mood.level`);
    ok(on8th !== "celebrate", "the day after is an ordinary good day");
  });

  return t;
}
