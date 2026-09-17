import { createEnv, makeTester, eq, ok, notOk } from "./harness.mjs";

export default async function () {
  const t = makeTester("bootstrap + install paths");

  // ── Fresh install ──────────────────────────────────────────────────────────
  await t("fresh install writes v2 defaults", async () => {
    const e = createEnv();
    await e.runAsync(`await bootstrap();`);
    eq(e.local._store.schemaVersion, 2);
    eq(e.local._store.trustedSites, []);
    eq(e.local._store.sensitivity, "balanced");
    eq(e.local._store.enableDwellDetection, false);
    ok(e.local._store.today.date);
  });

  await t("fresh install has every key the schema defines", async () => {
    const e = createEnv();
    await e.runAsync(`await bootstrap();`);
    const expected = Object.keys(e.run(`getDefaults(todayLocal())`));
    const missing = expected.filter((k) => !(k in e.local._store));
    eq(missing, []);
  });

  // ── Upgrade from v0 ────────────────────────────────────────────────────────
  await t("v0 profile upgrades to v2 and keeps its data", async () => {
    const e = createEnv();
    await e.runAsync(`await storageSet({
      streak: 4, redirectsToday: 2, safeDomains: ["www.old.com"], enabled: true,
    });`);
    await e.runAsync(`await bootstrap();`);
    eq(e.local._store.schemaVersion, 2);
    eq(e.local._store.totals.closedDays, 3);
    eq(e.local._store.trustedSites[0].domain, "old.com");
  });

  await t("v0 legacy keys are cleaned up", async () => {
    const e = createEnv();
    await e.runAsync(`await storageSet({ streak: 4, redirectsToday: 2, lastStreakDay: "x" });`);
    await e.runAsync(`await bootstrap();`);
    for (const k of ["streak", "redirectsToday", "lastStreakDay"]) {
      notOk(k in e.local._store, `${k} should be removed`);
    }
  });

  // ── Upgrade from v1 ────────────────────────────────────────────────────────
  await t("v1 profile upgrades to v2", async () => {
    const e = createEnv();
    await e.runAsync(`await storageSet({
      schemaVersion: 1, safeDomains: ["a.com", "www.b.com"], goalMinutes: 180,
      today: { date: "2026-09-16", cleanMinutes: 45, redirects: 1 },
      totals: { closedDays: 9, reflectionsLogged: 20, lifetimeCleanMinutes: 900 },
    });`);
    await e.runAsync(`await bootstrap();`);
    eq(e.local._store.schemaVersion, 2);
    eq(e.local._store.trustedSites.length, 2);
    eq(e.local._store.totals.closedDays, 9, "totals must survive");
    eq(e.local._store.goalMinutes, 180, "settings must survive");
    eq(e.local._store.today.browsedMinutes, 45);
  });

  await t("safeDomains is removed after the v1 upgrade", async () => {
    const e = createEnv();
    await e.runAsync(`await storageSet({ schemaVersion: 1, safeDomains: ["a.com"] });`);
    await e.runAsync(`await bootstrap();`);
    notOk("safeDomains" in e.local._store);
  });

  // ── Already current ────────────────────────────────────────────────────────
  await t("a v2 profile is left alone", async () => {
    const e = createEnv();
    await e.runAsync(`
      await bootstrap();
      await addTrustedSite("keep.com", "manual");
      await storageSet({ sensitivity: "strict" });
    `);
    await e.runAsync(`await bootstrap();`);
    eq(e.local._store.sensitivity, "strict", "user settings must not be reset");
    eq(e.local._store.trustedSites.length, 1);
  });

  await t("bootstrap is safe to run repeatedly", async () => {
    const e = createEnv();
    await e.runAsync(`await bootstrap(); await bootstrap(); await bootstrap();`);
    eq(e.local._store.schemaVersion, 2);
    eq(e.local._store.trustedSites, []);
  });

  // ── Partial / corrupted profiles ───────────────────────────────────────────
  // A write interrupted by a crash, or a hand-edited backup, must not brick startup.
  await t("a v2 profile missing keys is backfilled", async () => {
    const e = createEnv();
    await e.runAsync(`await storageSet({ schemaVersion: 2, today: getDefaultToday("2026-09-16") });`);
    await e.runAsync(`await bootstrap();`);
    eq(e.local._store.sensitivity, "balanced");
    eq(e.local._store.trustedSites, []);
    eq(e.local._store.blocks, []);
  });

  await t("backfill does not overwrite existing values", async () => {
    const e = createEnv();
    await e.runAsync(`await storageSet({ schemaVersion: 2, goalMinutes: 240, sensitivity: "lenient" });`);
    await e.runAsync(`await bootstrap();`);
    eq(e.local._store.goalMinutes, 240);
    eq(e.local._store.sensitivity, "lenient");
  });

  await t("bootstrap returns the resolved state", async () => {
    const e = createEnv();
    const state = await e.runAsync(`return await bootstrap();`);
    eq(state.schemaVersion, 2);
  });

  return t;
}
