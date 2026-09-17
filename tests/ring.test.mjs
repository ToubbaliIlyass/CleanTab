import { createEnv, makeTester, eq, ok, notOk } from "./harness.mjs";

export default async function () {
  const t = makeTester("ring: clean share");
  const { run } = createEnv();
  const share = (c, b) => run(`cleanShare({cleanMinutes:${c}, browsedMinutes:${b}})`);
  const closed = (c, b, g = 0.95) => run(`ringIsClosed({cleanMinutes:${c}, browsedMinutes:${b}}, ${g})`);

  // ── cleanShare ─────────────────────────────────────────────────────────────
  t("no browsing is 0, not NaN", () => eq(share(0, 0), 0));
  t("all clean is 1", () => eq(share(40, 40), 1));
  t("half clean is 0.5", () => eq(share(20, 40), 0.5));
  t("clamps above 1 (clean can never exceed browsed)", () => eq(share(50, 40), 1));
  t("no clean minutes is 0", () => eq(share(0, 60), 0));
  t("missing day object is 0", () => eq(run(`cleanShare(undefined)`), 0));
  t("empty day object is 0", () => eq(run(`cleanShare({})`), 0));

  // ── ringIsClosed: the browsed-minutes floor ────────────────────────────────
  // Without a floor, one clean minute reads as a perfect day.
  t("1 clean minute does not close the ring", () => notOk(closed(1, 1)));
  t("19 browsed minutes is below the floor", () => notOk(closed(19, 19)));
  t("20 browsed minutes meets the floor", () => ok(closed(20, 20)));

  // ── ringIsClosed: the share goal ───────────────────────────────────────────
  t("exactly at the goal closes", () => ok(closed(95, 100)));
  t("just under the goal stays open", () => notOk(closed(94, 100)));
  t("a long dirty day stays open", () => notOk(closed(200, 300)));

  // This is the whole point of the ratio model (plan §9.1): a short clean day is a
  // closed day, and shutting the laptop is not a penalty.
  t("a short clean day closes", () => ok(closed(25, 25)));
  t("a long clean day also closes", () => ok(closed(480, 480)));
  t("a short clean day and a long clean day are equal", () => eq(share(25, 25), share(480, 480)));

  // ── Goal is configurable ───────────────────────────────────────────────────
  t("a lower goal closes an imperfect day", () => ok(closed(80, 100, 0.8)));
  t("a perfect goal demands perfection", () => notOk(closed(99, 100, 1.0)));

  return t;
}
