import { createEnv, makeTester, eq, ok, notOk } from "./harness.mjs";

export default async function () {
  const t = makeTester("schema migrations");
  const { run } = createEnv();

  // ── v0 → v1 ────────────────────────────────────────────────────────────────
  const v1 = run(`migrateV0ToV1({
    streak: 5, lastStreakDay: "2026-09-15", redirectsToday: 3,
    safeDomains: ["example.com"], enabled: true,
  }, "2026-09-16")`);

  t("v0→v1 sets version 1", () => eq(v1.schemaVersion, 1));
  t("v0→v1 carries redirect count", () => eq(v1.today.redirects, 3));
  t("v0→v1 maps streak to closed days", () => eq(v1.totals.closedDays, 4));
  t("v0→v1 carries safe domains", () => eq(v1.safeDomains, ["example.com"]));
  t("v0→v1 on an empty profile does not throw", () =>
    ok(run(`migrateV0ToV1({}, "2026-09-16").schemaVersion`) === 1));

  // ── v1 → v2 ────────────────────────────────────────────────────────────────
  const v2 = run(`migrateV1ToV2({
    schemaVersion: 1,
    safeDomains: ["www.example.com", "example.com", "Other.ORG", ""],
    today: { date: "2026-09-16", cleanMinutes: 30, redirects: 2 },
    goalMinutes: 180,
    reflections: [{ ts: 1, chip: "bored" }],
  })`);

  t("v1→v2 sets version 2", () => eq(v2.schemaVersion, 2));
  t("v1→v2 converts strings to records", () => ok(typeof v2.trustedSites[0] === "object"));
  t("v1→v2 normalizes and dedupes www vs bare", () => eq(v2.trustedSites.length, 2));
  t("v1→v2 lowercases domains", () =>
    ok(v2.trustedSites.some((e) => e.domain === "other.org")));
  t("v1→v2 drops empty entries", () =>
    notOk(v2.trustedSites.some((e) => !e.domain)));

  // These entries were created by a flow that approved nearly everything put to it.
  // They are kept (deleting settings silently is worse) but must be marked.
  t("v1→v2 tags legacy trust for review", () =>
    ok(v2.trustedSites.every((e) => e.source === "appeal-legacy")));

  t("v1→v2 seeds browsedMinutes from cleanMinutes", () => eq(v2.today.browsedMinutes, 30));
  t("v1→v2 adds sensitivity", () => eq(v2.sensitivity, "balanced"));
  t("v1→v2 adds cleanShareGoal", () => eq(v2.cleanShareGoal, 0.95));
  t("v1→v2 defaults dwell to off", () => eq(v2.enableDwellDetection, false));
  t("v1→v2 adds a blocks array", () => eq(v2.blocks, []));
  t("v1→v2 preserves unrelated keys", () => eq(v2.goalMinutes, 180));
  t("v1→v2 preserves reflections", () => eq(v2.reflections.length, 1));

  // ── Idempotency ────────────────────────────────────────────────────────────
  // A migration that runs twice (interrupted write, reinstall over existing data)
  // must not duplicate trust entries or reset counters.
  const twice = run(`migrateV1ToV2(migrateV1ToV2({
    schemaVersion: 1,
    safeDomains: ["example.com"],
    today: { date: "2026-09-16", cleanMinutes: 30 },
  }))`);
  t("v1→v2 is idempotent: no duplicate trust", () => eq(twice.trustedSites.length, 1));
  t("v1→v2 is idempotent: counters intact", () => eq(twice.today.cleanMinutes, 30));
  t("v1→v2 is idempotent: browsedMinutes not doubled", () => eq(twice.today.browsedMinutes, 30));

  // ── Chained v0 → v2 ────────────────────────────────────────────────────────
  const chained = run(`migrateV1ToV2(migrateV0ToV1({
    streak: 3, redirectsToday: 1, safeDomains: ["www.old.com"],
  }, "2026-09-16"))`);
  t("v0→v2 chain reaches version 2", () => eq(chained.schemaVersion, 2));
  t("v0→v2 chain converts trust", () => eq(chained.trustedSites[0].domain, "old.com"));
  t("v0→v2 chain keeps closed days", () => eq(chained.totals.closedDays, 2));

  // ── Degenerate inputs ──────────────────────────────────────────────────────
  t("v1→v2 with no safeDomains", () =>
    eq(run(`migrateV1ToV2({schemaVersion:1}).trustedSites`), []));
  t("v1→v2 with a non-array safeDomains", () =>
    eq(run(`migrateV1ToV2({schemaVersion:1, safeDomains:"nope"}).trustedSites`), []));
  t("v1→v2 with no today", () =>
    eq(run(`migrateV1ToV2({schemaVersion:1}).today.browsedMinutes`), 0));

  return t;
}
