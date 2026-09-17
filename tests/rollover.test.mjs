import { createEnv, makeTester, eq, ok, notOk } from "./harness.mjs";

export default async function () {
  const t = makeTester("daily rollover + dates");

  async function withDay(iso, seed = {}) {
    const env = createEnv({ now: Date.parse(iso) });
    await env.runAsync(`await storageSet({
      schemaVersion: 2, trustedSites: [], blocks: [], reflections: [],
      totals: { closedDays: 0, reflectionsLogged: 0, lifetimeCleanMinutes: 0 },
      history: {}, cleanShareGoal: 0.95, goalMinutes: 120,
      today: getDefaultToday("2026-09-16"),
      ...${JSON.stringify(seed)},
    });`);
    return env;
  }

  // ── todayLocal ─────────────────────────────────────────────────────────────
  await t("date key is local, not UTC", async () => {
    // 23:30 local on the 16th. A UTC-based key would roll to the 17th in most of
    // the western hemisphere; the local key must stay on the 16th.
    const e = createEnv({ now: Date.parse("2026-09-16T23:30:00") });
    eq(e.run(`todayLocal()`), "2026-09-16");
  });

  await t("date key pads single digits", async () => {
    const e = createEnv({ now: Date.parse("2026-01-05T10:00:00") });
    eq(e.run(`todayLocal()`), "2026-01-05");
  });

  await t("date key handles a leap day", async () => {
    const e = createEnv({ now: Date.parse("2028-02-29T10:00:00") });
    eq(e.run(`todayLocal()`), "2028-02-29");
  });

  await t("daysBetween counts forward", async () => {
    const e = createEnv();
    eq(e.run(`daysBetween("2026-09-01", "2026-09-16")`), 15);
  });

  // ── Rollover behaviour ─────────────────────────────────────────────────────
  await t("same day is a no-op", async () => {
    const e = await withDay("2026-09-16T12:00:00", {
      today: { date: "2026-09-16", cleanMinutes: 30, browsedMinutes: 30, redirects: 1, reflections: 0, ringClosedAt: null },
    });
    await e.runAsync(`await handleDailyRollover();`);
    eq(e.local._store.today.cleanMinutes, 30);
    eq(Object.keys(e.local._store.history).length, 0);
  });

  await t("a new day archives yesterday and resets today", async () => {
    const e = await withDay("2026-09-17T09:00:00", {
      today: { date: "2026-09-16", cleanMinutes: 40, browsedMinutes: 50, redirects: 2, reflections: 1, ringClosedAt: null },
    });
    await e.runAsync(`await handleDailyRollover();`);
    ok(e.local._store.history["2026-09-16"], "yesterday archived");
    eq(e.local._store.history["2026-09-16"].cleanMinutes, 40);
    eq(e.local._store.history["2026-09-16"].browsedMinutes, 50);
    eq(e.local._store.today.date, "2026-09-17");
    eq(e.local._store.today.cleanMinutes, 0);
  });

  await t("archive stores the clean share", async () => {
    const e = await withDay("2026-09-17T09:00:00", {
      today: { date: "2026-09-16", cleanMinutes: 40, browsedMinutes: 50, redirects: 0, reflections: 0, ringClosedAt: null },
    });
    await e.runAsync(`await handleDailyRollover();`);
    eq(e.local._store.history["2026-09-16"].cleanShare, 0.8);
  });

  await t("a closed day increments closedDays", async () => {
    const e = await withDay("2026-09-17T09:00:00", {
      today: { date: "2026-09-16", cleanMinutes: 50, browsedMinutes: 50, redirects: 0, reflections: 0, ringClosedAt: null },
    });
    await e.runAsync(`await handleDailyRollover();`);
    eq(e.local._store.totals.closedDays, 1);
    eq(e.local._store.history["2026-09-16"].ringClosed, true);
  });

  await t("an open day does not increment closedDays", async () => {
    const e = await withDay("2026-09-17T09:00:00", {
      today: { date: "2026-09-16", cleanMinutes: 20, browsedMinutes: 50, redirects: 0, reflections: 0, ringClosedAt: null },
    });
    await e.runAsync(`await handleDailyRollover();`);
    eq(e.local._store.totals.closedDays, 0);
    eq(e.local._store.history["2026-09-16"].ringClosed, false);
  });

  await t("a day below the browsing floor does not count as closed", async () => {
    const e = await withDay("2026-09-17T09:00:00", {
      today: { date: "2026-09-16", cleanMinutes: 5, browsedMinutes: 5, redirects: 0, reflections: 0, ringClosedAt: null },
    });
    await e.runAsync(`await handleDailyRollover();`);
    eq(e.local._store.totals.closedDays, 0);
  });

  await t("lifetime clean minutes accumulate", async () => {
    const e = await withDay("2026-09-17T09:00:00", {
      today: { date: "2026-09-16", cleanMinutes: 40, browsedMinutes: 40, redirects: 0, reflections: 0, ringClosedAt: null },
      totals: { closedDays: 3, reflectionsLogged: 7, lifetimeCleanMinutes: 500 },
    });
    await e.runAsync(`await handleDailyRollover();`);
    eq(e.local._store.totals.lifetimeCleanMinutes, 540);
  });

  await t("first run with no prior date just initializes today", async () => {
    const e = await withDay("2026-09-16T09:00:00", { today: {} });
    await e.runAsync(`await handleDailyRollover();`);
    eq(e.local._store.today.date, "2026-09-16");
    eq(Object.keys(e.local._store.history).length, 0);
  });

  await t("skipping several days still archives the last one", async () => {
    const e = await withDay("2026-09-25T09:00:00", {
      today: { date: "2026-09-16", cleanMinutes: 30, browsedMinutes: 30, redirects: 0, reflections: 0, ringClosedAt: null },
    });
    await e.runAsync(`await handleDailyRollover();`);
    ok(e.local._store.history["2026-09-16"]);
    eq(e.local._store.today.date, "2026-09-25");
    // Days the machine was off are absent, not zero-filled — an absence, not a bad day.
    eq(Object.keys(e.local._store.history).length, 1);
  });

  await t("history is trimmed to 365 days, oldest first", async () => {
    const history = {};
    const base = new Date("2024-01-01");
    for (let i = 0; i < 400; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      history[d.toISOString().slice(0, 10)] = { cleanMinutes: 10, browsedMinutes: 10 };
    }
    const e = await withDay("2026-09-17T09:00:00", {
      history,
      today: { date: "2026-09-16", cleanMinutes: 10, browsedMinutes: 10, redirects: 0, reflections: 0, ringClosedAt: null },
    });
    await e.runAsync(`await handleDailyRollover();`);
    ok(Object.keys(e.local._store.history).length <= 365,
       `got ${Object.keys(e.local._store.history).length}`);
    notOk(e.local._store.history["2024-01-01"], "oldest day should be dropped");
    ok(e.local._store.history["2026-09-16"], "newest day should be kept");
  });

  await t("rollover twice in a row is safe", async () => {
    const e = await withDay("2026-09-17T09:00:00", {
      today: { date: "2026-09-16", cleanMinutes: 40, browsedMinutes: 40, redirects: 0, reflections: 0, ringClosedAt: null },
    });
    await e.runAsync(`await handleDailyRollover(); await handleDailyRollover();`);
    eq(e.local._store.totals.closedDays, 1, "must not double-count");
    eq(e.local._store.totals.lifetimeCleanMinutes, 40);
  });

  return t;
}
