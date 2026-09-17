import { createEnv, makeTester, eq, ok, notOk } from "./harness.mjs";

export default async function () {
  const t = makeTester("storage operations");

  async function fresh() {
    const env = createEnv();
    await env.runAsync(`await storageSet({
      schemaVersion: 2, trustedSites: [], blocks: [], reflections: [], totals: {},
      history: {}, cleanShareGoal: 0.95, goalMinutes: 120,
      today: getDefaultToday("2026-09-16"),
    });`);
    return env;
  }

  // ── Trust ──────────────────────────────────────────────────────────────────
  await t("adds a trusted site", async () => {
    const e = await fresh();
    await e.runAsync(`await addTrustedSite("example.com", "manual");`);
    eq(e.local._store.trustedSites.length, 1);
  });

  await t("normalizes on write", async () => {
    const e = await fresh();
    await e.runAsync(`await addTrustedSite("WWW.Example.COM", "manual");`);
    eq(e.local._store.trustedSites[0].domain, "example.com");
  });

  await t("does not duplicate after normalization", async () => {
    const e = await fresh();
    await e.runAsync(`
      await addTrustedSite("www.example.com", "appeal");
      await addTrustedSite("example.com", "manual");
      await addTrustedSite("EXAMPLE.com", "manual");
    `);
    eq(e.local._store.trustedSites.length, 1);
  });

  await t("records the source", async () => {
    const e = await fresh();
    await e.runAsync(`await addTrustedSite("a.com", "appeal");`);
    eq(e.local._store.trustedSites[0].source, "appeal");
  });

  await t("removes by any spelling of the domain", async () => {
    const e = await fresh();
    await e.runAsync(`
      await addTrustedSite("example.com", "manual");
      await removeTrustedSite("WWW.example.com");
    `);
    eq(e.local._store.trustedSites.length, 0);
  });

  await t("removing a domain that isn't there is a no-op", async () => {
    const e = await fresh();
    await e.runAsync(`await removeTrustedSite("nothere.com");`);
    eq(e.local._store.trustedSites.length, 0);
  });

  await t("rejects an empty domain", async () => {
    const e = await fresh();
    await e.runAsync(`await addTrustedSite("", "manual");`);
    eq(e.local._store.trustedSites.length, 0);
  });

  // ── Block log ──────────────────────────────────────────────────────────────
  await t("records a block and increments today's count", async () => {
    const e = await fresh();
    await e.runAsync(`await recordBlock("bad.com", "test reason");`);
    eq(e.local._store.blocks.length, 1);
    eq(e.local._store.today.redirects, 1);
  });

  await t("newest block is first", async () => {
    const e = await fresh();
    await e.runAsync(`
      await recordBlock("first.com", "a");
      await recordBlock("second.com", "b");
    `);
    eq(e.local._store.blocks[0].domain, "second.com");
  });

  await t("block log is capped at 25", async () => {
    const e = await fresh();
    await e.runAsync(`
      for (let i = 0; i < 40; i++) await recordBlock("d" + i + ".com", "r");
    `);
    eq(e.local._store.blocks.length, 25);
    eq(e.local._store.blocks[0].domain, "d39.com");
  });

  await t("block log stores no full URL", async () => {
    const e = await fresh();
    await e.runAsync(`await recordBlock("bad.com", "reason");`);
    const keys = Object.keys(e.local._store.blocks[0]).sort();
    eq(keys, ["domain", "reason", "ts"]);
  });

  // ── Reflections ────────────────────────────────────────────────────────────
  await t("records a reflection", async () => {
    const e = await fresh();
    await e.runAsync(`await recordReflection("bored", "example.com");`);
    eq(e.local._store.reflections.length, 1);
    eq(e.local._store.totals.reflectionsLogged, 1);
    eq(e.local._store.today.reflections, 1);
  });

  await t("reflection log is capped at 1000, dropping oldest", async () => {
    const e = await fresh();
    await e.runAsync(`
      for (let i = 0; i < 1005; i++) await recordReflection("bored", "d" + i + ".com");
    `);
    eq(e.local._store.reflections.length, 1000);
    eq(e.local._store.reflections[0].domain, "d5.com");
  });

  // ── Minute ticking ─────────────────────────────────────────────────────────
  await t("a clean minute advances both counters", async () => {
    const e = await fresh();
    await e.runAsync(`await tickMinute(true);`);
    eq(e.local._store.today.cleanMinutes, 1);
    eq(e.local._store.today.browsedMinutes, 1);
  });

  await t("a dirty minute advances only browsed", async () => {
    const e = await fresh();
    await e.runAsync(`await tickMinute(false);`);
    eq(e.local._store.today.cleanMinutes, 0);
    eq(e.local._store.today.browsedMinutes, 1);
  });

  await t("ringClosedAt is set once the ring closes", async () => {
    const e = await fresh();
    await e.runAsync(`for (let i = 0; i < 25; i++) await tickMinute(true);`);
    ok(typeof e.local._store.today.ringClosedAt === "number");
  });

  await t("ringClosedAt is not set before the floor", async () => {
    const e = await fresh();
    await e.runAsync(`for (let i = 0; i < 10; i++) await tickMinute(true);`);
    notOk(e.local._store.today.ringClosedAt);
  });

  await t("ringClosedAt does not move once set", async () => {
    const e = await fresh();
    await e.runAsync(`for (let i = 0; i < 25; i++) await tickMinute(true);`);
    const first = e.local._store.today.ringClosedAt;
    e.clock.advance(60000);
    await e.runAsync(`await tickMinute(true);`);
    eq(e.local._store.today.ringClosedAt, first);
  });

  await t("a later dirty run does not reopen a closed day", async () => {
    const e = await fresh();
    await e.runAsync(`
      for (let i = 0; i < 25; i++) await tickMinute(true);
      for (let i = 0; i < 20; i++) await tickMinute(false);
    `);
    ok(e.local._store.today.ringClosedAt, "should stay closed");
  });

  // ── Allowances (session-scoped) ────────────────────────────────────────────
  await t("an allowance is granted and honoured", async () => {
    const e = await fresh();
    eq(await e.runAsync(`
      await grantAllowance("https://x.com/page");
      return await hasAllowance("https://x.com/page");
    `), true);
  });

  await t("an allowance is URL-specific", async () => {
    const e = await fresh();
    eq(await e.runAsync(`
      await grantAllowance("https://x.com/page");
      return await hasAllowance("https://x.com/other");
    `), false);
  });

  await t("an allowance expires", async () => {
    const e = await fresh();
    await e.runAsync(`await grantAllowance("https://x.com/p", 1000);`);
    e.clock.advance(1001);
    eq(await e.runAsync(`return await hasAllowance("https://x.com/p");`), false);
  });

  await t("allowances live in session storage, not local", async () => {
    const e = await fresh();
    await e.runAsync(`await grantAllowance("https://x.com/p");`);
    ok(e.session._store.urlAllowances, "should be in session");
    notOk(e.local._store.urlAllowances, "should NOT persist to local");
  });

  // ── Site pauses ────────────────────────────────────────────────────────────
  await t("a site pause is set and read back", async () => {
    const e = await fresh();
    ok(await e.runAsync(`
      await pauseSite("example.com", 900000);
      return await getSitePause("example.com");
    `));
  });

  await t("a site pause normalizes the domain", async () => {
    const e = await fresh();
    ok(await e.runAsync(`
      await pauseSite("WWW.example.com", 900000);
      return await getSitePause("example.com");
    `));
  });

  await t("a site pause expires", async () => {
    const e = await fresh();
    await e.runAsync(`await pauseSite("example.com", 1000);`);
    e.clock.advance(1001);
    eq(await e.runAsync(`return await getSitePause("example.com");`), null);
  });

  await t("a site pause can be cleared early", async () => {
    const e = await fresh();
    eq(await e.runAsync(`
      await pauseSite("example.com", 900000);
      await clearSitePause("example.com");
      return await getSitePause("example.com");
    `), null);
  });

  await t("pausing one site does not pause another", async () => {
    const e = await fresh();
    eq(await e.runAsync(`
      await pauseSite("a.com", 900000);
      return await getSitePause("b.com");
    `), null);
  });

  // ── Goal recalibration ─────────────────────────────────────────────────────
  await t("recalibrate is a no-op below 7 days of history", async () => {
    const e = await fresh();
    await e.runAsync(`
      await storageSet({ history: { "2026-09-10": { cleanMinutes: 300 } }, goalMinutes: 120 });
      await recalibrateGoal();
    `);
    eq(e.local._store.goalMinutes, 120);
  });

  // Regression: history was read with Object.values().slice(-30), which is insertion
  // order, not date order. A profile written out of order recalibrated against the
  // wrong month.
  await t("recalibrate reads the most recent days by DATE, not insertion order", async () => {
    const e = await fresh();
    const history = {};
    // Insert old high-usage days AFTER recent low-usage days.
    for (let i = 1; i <= 10; i++) history[`2026-09-${String(i).padStart(2, "0")}`] = { cleanMinutes: 60 };
    const ordered = {};
    for (const k of Object.keys(history)) ordered[k] = history[k];
    ordered["2020-01-01"] = { cleanMinutes: 2000 };
    await e.runAsync(`
      await storageSet({ history: ${JSON.stringify(ordered)}, goalMinutes: 120 });
      await recalibrateGoal();
    `);
    // The 2020 outlier must not dominate; goal should move down toward the recent median.
    ok(e.local._store.goalMinutes < 120, `goal=${e.local._store.goalMinutes}`);
  });

  await t("recalibrate clamps to the 60..240 range", async () => {
    const e = await fresh();
    const history = {};
    for (let i = 1; i <= 10; i++) history[`2026-09-${String(i).padStart(2, "0")}`] = { cleanMinutes: 5000 };
    await e.runAsync(`
      await storageSet({ history: ${JSON.stringify(history)}, goalMinutes: 120 });
      await recalibrateGoal();
    `);
    const g = e.local._store.goalMinutes;
    ok(g >= 60 && g <= 240, `goal=${g}`);
  });

  return t;
}
