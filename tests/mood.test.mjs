import { createEnv, makeTester, eq, ok } from "./harness.mjs";

export default async function () {
  const t = makeTester("mascot mood");
  const { run } = createEnv();
  const mood = (o) => run(`mascotMood(${JSON.stringify({
    off: false, state: "quiet", protectedCount: 0, anyActive: true, milestoneToday: false, ...o,
  })})`);

  t("protection off is asleep, whatever else is true", () => {
    eq(mood({ off: true, state: "protected", protectedCount: 14 }).level, "asleep");
  });
  t("no tracked days yet waves hello", () => {
    const m = mood({ anyActive: false, state: "quiet" });
    eq([m.level, m.pose], ["hello", "wave"]);
  });
  t("a slip today is warm encouragement, never sad", () => {
    for (const state of ["passed", "paused"]) {
      const m = mood({ state, protectedCount: 9 });
      eq([m.level, m.pose], ["warm", "encourage"]);
    }
  });
  t("a quiet day with little history is calm", () => eq(mood({ protectedCount: 1 }).level, "calm"));
  t("a protected day is glad", () => eq(mood({ state: "protected", protectedCount: 2 }).level, "glad"));
  t("a good run of days is glad even before today counts", () => eq(mood({ protectedCount: 5 }).level, "glad"));
  t("ring nearly full or a milestone celebrates", () => {
    eq(mood({ state: "protected", protectedCount: 10 }).level, "celebrate");
    eq(mood({ state: "protected", protectedCount: 3, milestoneToday: true }).level, "celebrate");
  });
  t("levels get happier as protected days grow", () => {
    const order = ["calm", "glad", "celebrate"];
    const a = [1, 5, 11].map((n) => order.indexOf(mood({ state: "protected", protectedCount: n }).level));
    ok(a[0] <= a[1] && a[1] <= a[2], JSON.stringify(a));
  });
  t("every mood has a caption and an accessible label", () => {
    for (const o of [{ off: true }, { anyActive: false }, { state: "passed" }, {}, { state: "protected" }, { state: "protected", protectedCount: 12 }]) {
      const m = mood(o);
      ok(m.caption && m.label && m.pose);
    }
  });
  return t;
}
