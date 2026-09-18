// "Let me through once" — the daily cap.
//
// The escape hatch has to stay cheap for a genuine false positive and stop being a
// bypass for the fourth use on the same site. The counting is per ROOT DOMAIN, because
// counting per URL would let one hop to a sibling page reset it, which is no limit.

import { createEnv, makeTester, eq, ok, notOk } from "./harness.mjs";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export default async function () {
  const t = makeTester("allowance limit");
  const { run, runAsync, local } = createEnv();

  const now = run(`Date.now()`);
  const remaining = (events, domain) =>
    run(`allowanceRemaining(${JSON.stringify(events)}, ${JSON.stringify(domain)})`);
  const exhausted = (events, domain) =>
    run(`allowanceExhausted(${JSON.stringify(events)}, ${JSON.stringify(domain)})`);

  // ── The cap ────────────────────────────────────────────────────────────────

  t("a fresh domain has three uses", () => eq(remaining({}, "x.com"), 3));
  t("no record at all still has three", () => eq(remaining(null, "x.com"), 3));

  t("each use costs one", () => {
    eq(remaining({ "x.com": [now - HOUR] }, "x.com"), 2);
    eq(remaining({ "x.com": [now - HOUR, now - 2 * HOUR] }, "x.com"), 1);
    eq(remaining({ "x.com": [now - HOUR, now - 2 * HOUR, now - 3 * HOUR] }, "x.com"), 0);
  });

  t("the fourth use is refused", () =>
    ok(exhausted({ "x.com": [now, now, now] }, "x.com")));

  t("remaining never goes negative", () =>
    eq(remaining({ "x.com": [now, now, now, now, now] }, "x.com"), 0));

  // ── Scope ──────────────────────────────────────────────────────────────────

  t("the cap is per domain, not global", () => {
    const events = { "x.com": [now, now, now] };
    ok(exhausted(events, "x.com"));
    eq(remaining(events, "other.com"), 3, "a different site is unaffected");
  });

  // Counting per URL would make the limit meaningless — one click to a sibling page and
  // the counter is fresh.
  t("sibling pages share one domain's count", async () => {
    await runAsync(`
      await storageSet({ allowanceEvents: {} });
      await recordAllowance(domainFromUrl("https://x.com/a"));
      await recordAllowance(domainFromUrl("https://x.com/b"));
      await recordAllowance(domainFromUrl("https://x.com/c"));
    `);
    const state = await runAsync(`return allowanceStateFor("x.com");`);
    eq(state.remaining, 0);
    ok(state.exhausted);
  });

  t("www is not a separate site", async () => {
    eq(run(`domainFromUrl("https://www.x.com/a")`), run(`domainFromUrl("https://x.com/a")`));
  });

  // ── The window resets ──────────────────────────────────────────────────────
  // Same reasoning as the ring: a bad day costs you nothing tomorrow.

  t("uses older than a day are forgotten", () =>
    eq(remaining({ "x.com": [now - 25 * HOUR, now - 30 * HOUR, now - 2 * DAY] }, "x.com"), 3));

  t("a mixed record counts only what is inside the window", () =>
    eq(remaining({ "x.com": [now - 25 * HOUR, now - HOUR] }, "x.com"), 2));

  // ── Recording keeps the store bounded ──────────────────────────────────────

  t("recording drops expired entries", () => {
    const out = run(`recordAllowanceUse({"x.com":[${now - 2 * DAY}, ${now - HOUR}]}, "x.com", ${now})`);
    eq(out["x.com"].length, 2, "one expired dropped, one kept, one added");
  });

  t("domains that fully expire are removed", () => {
    const out = run(`recordAllowanceUse({"old.com":[${now - 3 * DAY}]}, "x.com", ${now})`);
    notOk("old.com" in out, "the record must not grow without bound");
    ok("x.com" in out);
  });

  t("junk in the record is ignored", () =>
    eq(run(`allowanceUsed({"x.com":[null,"nope",undefined]}, "x.com")`), 0));

  // ── What the user is told ──────────────────────────────────────────────────
  // A limit discovered on the fourth press reads as the tool breaking, so the count is
  // shown before it runs out and the exhausted message points somewhere useful.

  t("the remaining count is stated up front", () => {
    ok(run(`allowanceMessage(3)`).includes("3"));
    ok(run(`allowanceMessage(1)`).includes("Once more"));
  });

  t("the exhausted message points at the right alternative", () => {
    const m = run(`allowanceMessage(0)`);
    ok(m.includes("This site is fine"), "a genuine false positive belongs in the appeal");
  });

  // ── The escape hatch is still cheap when it should be ──────────────────────

  t("the first use is unconditional", () => {
    notOk(exhausted({}, "x.com"));
    eq(remaining({}, "x.com"), 3);
  });

  t("a day's limit is per day, not per session", async () => {
    // Stored in local, not session: a count that resets when Chrome restarts is not a
    // limit, it is a suggestion.
    const defaults = await runAsync(`return getDefaults(todayLocal());`);
    ok("allowanceEvents" in defaults, "must persist across restarts");
  });

  return t;
}
