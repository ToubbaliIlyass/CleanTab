import { createEnv, makeTester, eq, ok, notOk } from "./harness.mjs";

// Pictures you linger on: evidence adds up, one picture never blocks, points fade.
export default async function () {
  const t = makeTester("lingering on pictures");
  const e = createEnv();
  const run = (src) => e.run(src);
  const B = `getProfile("balanced")`;

  t("a clean picture is worth nothing", () => {
    eq(run(`dwellPoints(0.1, ${B})`), 0);
    eq(run(`dwellPoints(0, ${B})`), 0);
    eq(run(`dwellPoints(undefined, ${B})`), 0);
  });
  t("a flagged picture is one point, a near-certain one two", () => {
    eq(run(`dwellPoints(0.7, ${B})`), 1);
    eq(run(`dwellPoints(0.95, ${B})`), 2);
  });
  t("strict flags on less, lenient on more", () => {
    eq(run(`dwellPoints(0.5, getProfile("strict"))`), 1);
    eq(run(`dwellPoints(0.5, ${B})`), 0);
    eq(run(`dwellPoints(0.7, getProfile("lenient"))`), 0);
  });

  // ── One picture is never enough ───────────────────────────────────────────
  t("one near-certain picture, glanced at, does not block", () => {
    notOk(run(`dwellBlocks(dwellAdd([], "a", 2, 1000), 1000)`));
  });
  t("one borderline picture never blocks, however long it is looked at", () => {
    let ev = run(`dwellAdd([], "a", 1, 1000)`);
    for (let i = 1; i <= 10; i++) {
      e.ctx.__ev = ev;
      ev = run(`dwellLinger(__ev, "a", ${1000 + i * 4000})`);
    }
    e.ctx.__ev = ev;
    eq(run(`dwellTotal(__ev, 41000)`), 2);
    notOk(run(`dwellBlocks(__ev, 41000)`));
  });

  // ── What does block: a pattern ────────────────────────────────────────────
  t("staying on a near-certain picture blocks", () => {
    e.ctx.__ev = run(`dwellAdd([], "a", 2, 1000)`);
    e.ctx.__ev = run(`dwellLinger(__ev, "a", 5000)`);
    ok(run(`dwellBlocks(__ev, 5000)`));
  });
  t("three borderline pictures block", () => {
    e.ctx.__ev = run(`dwellAdd(dwellAdd(dwellAdd([], "a", 1, 1000), "b", 1, 4000), "c", 1, 8000)`);
    ok(run(`dwellBlocks(__ev, 8000)`));
  });
  t("two borderline pictures do not", () => {
    e.ctx.__ev = run(`dwellAdd(dwellAdd([], "a", 1, 1000), "b", 1, 4000)`);
    notOk(run(`dwellBlocks(__ev, 4000)`));
  });
  t("a near-certain picture plus a borderline one blocks", () => {
    e.ctx.__ev = run(`dwellAdd(dwellAdd([], "a", 2, 1000), "b", 1, 4000)`);
    ok(run(`dwellBlocks(__ev, 4000)`));
  });

  // ── Guards against creeping toward a block ────────────────────────────────
  t("the same picture seen again is not counted twice", () => {
    e.ctx.__ev = run(`dwellAdd(dwellAdd(dwellAdd([], "a", 1, 1000), "a", 1, 3000), "a", 1, 6000)`);
    eq(run(`dwellTotal(__ev, 6000)`), 1);
  });
  t("evidence fades after two minutes", () => {
    e.ctx.__ev = run(`dwellAdd(dwellAdd([], "a", 1, 1000), "b", 1, 2000)`);
    eq(run(`dwellTotal(__ev, 2000 + 121000)`), 0);
    // so a third borderline picture much later starts from one, not three
    e.ctx.__ev = run(`dwellAdd(__ev, "c", 1, 200000)`);
    eq(run(`dwellTotal(__ev, 200000)`), 1);
  });
  t("lingering stops adding once its cap is reached", () => {
    e.ctx.__ev = run(`dwellAdd([], "a", 2, 0)`);
    ok(run(`dwellCanLinger(__ev, "a", 0)`));
    e.ctx.__ev = run(`dwellLinger(dwellLinger(dwellLinger(__ev, "a", 4000), "a", 8000), "a", 12000)`);
    eq(run(`dwellTotal(__ev, 12000)`), 4);
    notOk(run(`dwellCanLinger(__ev, "a", 12000)`));
  });
  t("lingering on a picture that was never flagged adds nothing", () => {
    eq(run(`dwellTotal(dwellLinger([], "zzz", 1000), 1000)`), 0);
    notOk(run(`dwellCanLinger([], "zzz", 1000)`));
  });

  return t;
}
