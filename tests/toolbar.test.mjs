import { createEnv, makeTester, eq, ok } from "./harness.mjs";

export default async function () {
  const t = makeTester("toolbar icon");
  const { run } = createEnv();
  const levels = ["asleep", "hello", "calm", "glad", "celebrate", "warm"];
  t("every popup mood level has a toolbar face", () => {
    for (const l of levels) eq(run(`toolbarSpec("${l}").level`), l);
  });
  t("each level maps to its own 16 and 32 px files, and the files exist", async () => {
    const fs = await import("node:fs");
    const seen = new Set();
    for (const l of levels) {
      const p = run(`toolbarSpec("${l}").path`);
      for (const size of [16, 32]) {
        ok(fs.existsSync(new URL(`../${p[size]}`, import.meta.url)), p[size]);
        seen.add(p[size]);
      }
    }
    eq(seen.size, levels.length * 2);
  });
  t("an unknown level falls back to calm", () => eq(run(`toolbarSpec("nope").level`), "calm"));

  const data = (o) => ({ today: {}, history: {}, totals: {}, enabled: true, ...o });
  const moodOf = (d) => run(`moodFromData(${JSON.stringify(d)}, "2026-09-20", 1000).mood.level`);
  t("moodFromData: off, no data, protected day", () => {
    eq(moodOf(data({ enabled: false })), "asleep");
    eq(moodOf(data({})), "hello");
    eq(moodOf(data({ today: { browsedMinutes: 30, passes: 0, pauses: 0, offs: 0 } })), "glad");
    eq(moodOf(data({ today: { browsedMinutes: 30, passes: 1, pauses: 0, offs: 0 } })), "warm");
  });
  t("the toolbar and popup share one mood function", () => {
    const d = data({ today: { browsedMinutes: 30, passes: 0, pauses: 0, offs: 0 } });
    eq(run(`moodFromData(${JSON.stringify(d)}, "2026-09-20").mood`),
       run(`mascotMood({off:false,state:"protected",protectedCount:1,anyActive:true,milestoneToday:false})`));
  });
  return t;
}
