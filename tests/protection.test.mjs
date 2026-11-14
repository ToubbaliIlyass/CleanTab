import { createEnv, makeTester, eq, ok, notOk } from "./harness.mjs";

export default async function () {
  const t = makeTester("protected days + pauses + blocklist");
  const e = createEnv();
  const run = (src) => e.run(src);

  // ── dayState ───────────────────────────────────────────────────────────────
  t("a browsed day with no overrides is protected", () => {
    eq(run(`dayState({ browsedMinutes: 12, passes: 0, pauses: 0, offs: 0 })`), "protected");
  });
  t("too little browsing is quiet, not bad", () => {
    eq(run(`dayState({ browsedMinutes: 3, passes: 0, pauses: 0, offs: 0 })`), "quiet");
    eq(run(`dayState(undefined)`), "quiet");
  });
  t("a pass-through makes the day passed", () => {
    eq(run(`dayState({ browsedMinutes: 40, passes: 1, pauses: 0, offs: 0 })`), "passed");
  });
  t("a quick pause or full disable makes the day paused", () => {
    eq(run(`dayState({ browsedMinutes: 40, passes: 0, pauses: 1, offs: 0 })`), "paused");
    eq(run(`dayState({ browsedMinutes: 40, passes: 0, pauses: 0, offs: 1 })`), "paused");
  });
  t("a pass outranks a pause", () => {
    eq(run(`dayState({ browsedMinutes: 40, passes: 1, pauses: 1, offs: 0 })`), "passed");
  });

  // ── migration of stored data: days recorded before the counters existed ───
  t("a legacy day with a clean share is protected", () => {
    eq(run(`dayState({ browsedMinutes: 30, cleanMinutes: 30 })`), "protected");
  });
  t("a legacy day with a dip in clean share is passed", () => {
    eq(run(`dayState({ browsedMinutes: 30, cleanMinutes: 20 })`), "passed");
  });
  t("a legacy day with little browsing is quiet", () => {
    eq(run(`dayState({ browsedMinutes: 4, cleanMinutes: 4 })`), "quiet");
  });

  // ── window: forgiving by construction ─────────────────────────────────────
  const hist = (n, extra = {}) => {
    const h = {};
    for (let i = 1; i <= n; i++) {
      const d = new Date(2026, 8, 20 - i);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      h[k] = { browsedMinutes: 30, passes: 0, pauses: 0, offs: 0, ...(extra[i] || {}) };
    }
    return h;
  };
  t("window keys are 14 consecutive local dates ending today", () => {
    const keys = run(`windowKeys("2026-03-02")`);
    eq(keys.length, 14);
    eq(keys[13], "2026-03-02");
    eq(keys[0], "2026-02-17");
  });
  t("counts protected days in the last 14", () => {
    e.ctx.__h = hist(13);
    const w = run(`protectionWindow(__h, { browsedMinutes: 15, passes: 0, pauses: 0, offs: 0 }, "2026-09-20")`);
    eq(w.protected, 14);
  });
  t("one slip lowers the count by one and does not reset it", () => {
    e.ctx.__h = hist(13, { 5: { passes: 2 } });
    const w = run(`protectionWindow(__h, { browsedMinutes: 15, passes: 0, pauses: 0, offs: 0 }, "2026-09-20")`);
    eq([w.protected, w.passed], [13, 1]);
  });
  t("the slip ages out of the window", () => {
    e.ctx.__h = hist(20, { 15: { passes: 1 } });
    const w = run(`protectionWindow(__h, { browsedMinutes: 15, passes: 0, pauses: 0, offs: 0 }, "2026-09-20")`);
    eq(w.passed, 0);
    eq(w.protected, 14);
  });
  t("quiet days do not count against anyone", () => {
    e.ctx.__h = hist(13, { 3: { browsedMinutes: 0 }, 4: { browsedMinutes: 2 } });
    const w = run(`protectionWindow(__h, { browsedMinutes: 15, passes: 0, pauses: 0, offs: 0 }, "2026-09-20")`);
    eq([w.protected, w.passed, w.paused, w.quiet], [12, 0, 0, 2]);
  });
  t("best run skips quiet days and ends on a slip", () => {
    e.ctx.__h = {
      "2026-09-01": { browsedMinutes: 30, passes: 0, pauses: 0, offs: 0 },
      "2026-09-02": { browsedMinutes: 30, passes: 0, pauses: 0, offs: 0 },
      "2026-09-03": { browsedMinutes: 0, passes: 0, pauses: 0, offs: 0 },
      "2026-09-04": { browsedMinutes: 30, passes: 0, pauses: 0, offs: 0 },
      "2026-09-05": { browsedMinutes: 30, passes: 1, pauses: 0, offs: 0 },
      "2026-09-06": { browsedMinutes: 30, passes: 0, pauses: 0, offs: 0 },
    };
    eq(run(`bestRun(__h, null, null)`), 3);
  });
  t("plant stage follows the protected count", () => {
    eq([run(`plantStage(0)`), run(`plantStage(4)`), run(`plantStage(10)`)], ["sprout", "leafy", "bloom"]);
  });
  t("milestones", () => {
    eq(run(`reachedMilestones(0)`), []);
    eq(run(`reachedMilestones(31)`), [7, 30]);
  });

  // ── quick pause limits ─────────────────────────────────────────────────────
  t("three quick pauses a day, then none until they age out", () => {
    const now = 1_000_000_000_000;
    eq(run(`quickPausesRemaining([], ${now})`), 3);
    eq(run(`quickPausesRemaining([${now - 1000}, ${now - 2000}], ${now})`), 1);
    eq(run(`quickPausesRemaining([${now - 1000}, ${now - 2000}, ${now - 3000}], ${now})`), 0);
    eq(run(`quickPausesRemaining([${now - 25 * 3600e3}, ${now - 2000}], ${now})`), 2);
  });
  t("recordQuickPause drops expired entries", () => {
    const now = 1_000_000_000_000;
    eq(run(`recordQuickPause([${now - 25 * 3600e3}], ${now})`), [now]);
  });

  // ── blocklist matching ─────────────────────────────────────────────────────
  t("a blocked domain matches itself, www and subdomains", () => {
    e.ctx.__b = [{ domain: "example.com", addedAt: 1 }];
    eq(run(`isUserBlocked(__b, "example.com")`), true);
    eq(run(`isUserBlocked(__b, "www.example.com")`), true);
    eq(run(`isUserBlocked(__b, "m.example.com")`), true);
  });
  t("it does not match lookalikes or parents", () => {
    e.ctx.__b = [{ domain: "example.com", addedAt: 1 }];
    eq(run(`isUserBlocked(__b, "notexample.com")`), false);
    eq(run(`isUserBlocked(__b, "example.com.evil.net")`), false);
    e.ctx.__b = [{ domain: "m.example.com", addedAt: 1 }];
    eq(run(`isUserBlocked(__b, "example.com")`), false);
  });
  t("empty list and empty host never match", () => {
    eq(run(`isUserBlocked([], "a.com")`), false);
    eq(run(`isUserBlocked([{domain:"a.com"}], "")`), false);
  });

  // ── storage helpers ────────────────────────────────────────────────────────
  await t("recordDayEvent upgrades a legacy day without losing minutes", async () => {
    const env = createEnv();
    await env.runAsync(`await storageSet({ today: { date: "2026-09-16", cleanMinutes: 5, browsedMinutes: 12, redirects: 1 } });`);
    await env.runAsync(`await recordDayEvent("passes");`);
    const today = env.local._store.today;
    eq([today.passes, today.pauses, today.browsedMinutes], [1, 0, 12]);
  });
  await t("block list add is normalised, de-duplicated and removable", async () => {
    const env = createEnv();
    await env.runAsync(`await addBlockedSite("WWW.Example.com"); await addBlockedSite("example.com");`);
    eq(env.local._store.blockedSites.length, 1);
    eq(env.local._store.blockedSites[0].domain, "example.com");
    await env.runAsync(`await removeBlockedSite("www.example.com");`);
    eq(env.local._store.blockedSites.length, 0);
  });
  await t("rollover records the day's state and counts protected days", async () => {
    const env = createEnv();
    env.clock.set?.(new Date(2026, 8, 17, 9).getTime());
    await env.runAsync(`await storageSet({
      schemaVersion: 2, totals: { closedDays: 2 }, history: {}, cleanShareGoal: 0.95, goalMinutes: 120,
      today: { date: "2026-09-16", cleanMinutes: 15, browsedMinutes: 15, redirects: 1, passes: 0, pauses: 0, offs: 0 },
    }); await handleDailyRollover();`);
    eq(env.local._store.history["2026-09-16"].state, "protected");
    eq(env.local._store.totals.closedDays, 3);
  });
  await t("defaults backfill the new keys for an existing profile", async () => {
    const env = createEnv();
    await env.runAsync(`await storageSet({ schemaVersion: 2, enabled: true });`);
    await env.runAsync(`await bootstrap();`);
    eq(env.local._store.blockedSites, []);
    eq(env.local._store.pauseEvents, []);
  });

  return t;
}
