import { createEnv, makeTester, eq, ok, notOk } from "./harness.mjs";

// The weekly report: counts, comparisons and patterns from what is already stored.
export default async function () {
  const t = makeTester("weekly report");
  const now = new Date(2026, 8, 20, 15).getTime(); // Sunday 20 Sep 2026, 3pm
  const e = createEnv({ now });
  const run = (src) => e.run(src);
  const key = (daysAgo) => {
    const d = new Date(2026, 8, 20 - daysAgo);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const day = (extra = {}) => ({ browsedMinutes: 30, passes: 0, pauses: 0, offs: 0, redirects: 0, leaves: 0, reflections: 0, focusMinutes: 0, ...extra });
  const at = (daysAgo, hour) => new Date(2026, 8, 20 - daysAgo, hour).getTime();
  const report = (input) => { e.ctx.__in = { todayKey: key(0), ...input }; return run(`weekReport(__in, ${now})`); };

  // This week: 5 protected, 1 slip (opened anyway), 1 not counted. Last week: 3 slips.
  const history = {
    [key(1)]: day({ redirects: 1, leaves: 1 }),
    [key(2)]: day({ redirects: 4, leaves: 2, passes: 1, reflections: 2 }),
    [key(3)]: day({ focusMinutes: 50 }),
    [key(4)]: day({ browsedMinutes: 3 }),
    [key(5)]: day({ focusMinutes: 25 }),
    [key(6)]: day(),
    [key(7)]: day({ passes: 1, redirects: 2 }),
    [key(8)]: day({ offs: 1 }),
    [key(9)]: day({ pauses: 1 }),
    [key(10)]: day({ focusMinutes: 30 }),
  };
  const today = day({ redirects: 1, leaves: 1, focusMinutes: 25 });
  const r = report({ history, today });

  t("covers seven days ending today, oldest first", () => {
    eq(r.days.length, 7);
    eq(r.from, key(6));
    eq(r.to, key(0));
    ok(r.days[6].isToday);
    eq(r.days[6].weekday, "Sunday");
  });
  t("counts protected days, slips and days that do not count", () => {
    eq(r.week.protected, 5);
    eq(r.week.slips, 1);
    eq(r.week.notCounted, 1);
  });
  t("a flagged page opened anyway and protection being off are both a slip", () => {
    eq(r.days.find((d) => d.key === key(2)).state, "slip");
    const prevOnly = report({ history: { [key(1)]: day({ offs: 1 }) }, today: day() });
    eq(prevOnly.days.find((d) => d.key === key(1)).state, "slip");
  });
  t("adds up what happened at the pause screen", () => {
    eq(r.week.blocked, 6);
    eq(r.week.walkedAway, 4);
    eq(r.week.openedAnyway, 1);
    eq(r.week.reflections, 2);
    eq(r.week.focusMinutes, 100);
  });
  t("compares with the week before", () => {
    eq(r.prev.slips, 3);
    eq(r.delta.slips, -2);
    eq(r.delta.focusMinutes, 70);
    eq(r.headline, "Fewer slips than the week before.");
  });
  t("with no earlier week there is nothing to compare against", () => {
    const first = report({ history: { [key(1)]: day() }, today: day() });
    eq(first.prev, null);
    eq(first.delta.slips, null);
    eq(first.delta.protected, null);
  });
  t("the hardest day is the one with the most blocks", () => {
    eq(r.hardestDay.weekday, "Friday");
    eq(r.hardestDay.blocked, 4);
  });
  t("a single block anywhere is not a hardest day", () => {
    eq(report({ history: { [key(1)]: day({ redirects: 1 }) }, today: day() }).hardestDay, null);
  });
  t("how much was walked away from is a share of what was blocked", () => {
    ok(Math.abs(r.walkedAwayShare - 4 / 6) < 1e-9);
    eq(report({ history: {}, today: day() }).walkedAwayShare, null);
  });

  // ── Time of day, and feelings ─────────────────────────────────────────────
  const reflections = [
    { ts: at(1, 23), chip: "tired" }, { ts: at(2, 23), chip: "tired" }, { ts: at(2, 0), chip: "bored" },
    { ts: at(3, 14), chip: "tired" }, { ts: at(20, 23), chip: "lonely" }, { ts: at(1, 2), chip: "nonsense" },
  ];
  const withTimes = report({ history, today, reflections, blocks: [{ ts: at(4, 1) }], plans: { tired: "  close the laptop " } });
  t("says when most of it happens, once there is enough to say", () => {
    eq(withTimes.daypart.key, "night");
    ok(withTimes.daypart.share > 0.5);
    eq(report({ history, today, reflections: reflections.slice(0, 2) }).daypart, null);
  });
  t("feelings are counted for this week only, most common first", () => {
    eq(withTimes.feelings.map((f) => [f.chip, f.count]), [["tired", 3], ["bored", 1]]);
    eq(withTimes.topFeeling.label, "Tired");
    eq(withTimes.topFeeling.plan, "close the laptop");
  });
  t("day parts wrap past midnight", () => {
    eq(run(`reportDaypart(23).key`), "night");
    eq(run(`reportDaypart(3).key`), "night");
    eq(run(`reportDaypart(5).key`), "morning");
    eq(run(`reportDaypart(13).key`), "afternoon");
    eq(run(`reportDaypart(19).key`), "evening");
  });

  // ── Headlines never scold ─────────────────────────────────────────────────
  t("a full week says so", () => {
    const h = {}; for (let i = 1; i <= 6; i++) h[key(i)] = day();
    eq(report({ history: h, today: day() }).headline, "Seven for seven. A full week protected.");
  });
  t("a week of slips is named without a verdict", () => {
    const h = {}; for (let i = 1; i <= 6; i++) h[key(i)] = day({ passes: 1 });
    const hard = report({ history: h, today: day({ passes: 1 }) });
    eq(hard.week.slips, 7);
    ok(/next one starts now/.test(hard.headline));
  });
  t("an empty week is quiet, not bad", () => {
    ok(/quiet week/i.test(report({ history: {}, today: {} }).headline));
  });

  // ── When it is shown ──────────────────────────────────────────────────────
  t("not before seven days of use", () => {
    notOk(run(`reportDue("${key(6)}", "${key(0)}", null, ${now})`));
    ok(run(`reportDue("${key(7)}", "${key(0)}", null, ${now})`));
    notOk(run(`reportDue(null, "${key(0)}", null, ${now})`));
    // The coffee line: after a week, then put away for three months by any answer.
    notOk(run(`supportDue("${key(6)}", "${key(0)}", null, ${now})`));
    ok(run(`supportDue("${key(7)}", "${key(0)}", null, ${now})`));
    notOk(run(`supportDue("${key(40)}", "${key(0)}", ${now - 89 * 86400000}, ${now})`));
    ok(run(`supportDue("${key(140)}", "${key(0)}", ${now - 90 * 86400000}, ${now})`));
    notOk(run(`supportDue(null, "${key(0)}", null, ${now})`));
  });
  t("then once a week after it was last dismissed", () => {
    notOk(run(`reportDue("${key(40)}", "${key(0)}", ${now - 6 * 86400000}, ${now})`));
    ok(run(`reportDue("${key(40)}", "${key(0)}", ${now - 7 * 86400000}, ${now})`));
  });
  t("the first day is the earliest one there is anything for", () => {
    e.ctx.__h = { [key(3)]: day(), [key(12)]: day() };
    eq(run(`reportFirstDay(__h, { date: "${key(0)}" })`), key(12));
    eq(run(`reportFirstDay({}, { date: "${key(0)}" })`), key(0));
    eq(run(`reportFirstDay({}, {})`), null);
  });

  // ── The copyable summary carries counts, never sites ──────────────────────
  t("the summary is counts only", () => {
    e.ctx.__r = withTimes;
    const text = run(`reportSummary(__r)`);
    ok(text.includes("Protected 5 of the last 7 days, 1 slip"));
    ok(text.includes("Focused for 1 h 40 min"));
    ok(text.includes("Most common feeling: Tired"));
    notOk(/\.com|https?:/.test(text));
  });

  return t;
}
