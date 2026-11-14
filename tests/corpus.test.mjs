// Runs tests/corpus.mjs through decidePage(). Every benign page must pass; every flagged
// page must block. Also prints the false-positive rate per sensitivity so a loosening or
// tightening shows up in the numbers, not just in pass/fail.

import { createEnv, makeTester, eq, ok } from "./harness.mjs";
import { BENIGN, FLAGGED } from "./corpus.mjs";

export default async function () {
  const t = makeTester("detection corpus");
  const env = createEnv();

  const decide = (c, level) => env.run(`decidePage(${JSON.stringify({
    url: c.u, bodyText: c.b, titleTexts: [c.t, ...c.l], envTexts: c.l,
  })}, getProfile("${level}"))`);

  t("corpus is large enough", () => {
    ok(BENIGN.length >= 150, `benign cases: ${BENIGN.length}`);
    ok(FLAGGED.length >= 20, `flagged cases: ${FLAGGED.length}`);
  });

  for (const c of BENIGN) {
    t(`benign: ${c.n}`, () => {
      const d = decide(c, "balanced");
      ok(!d.block, `blocked as "${d.reason}" (url ${d.scores.url}, title ${d.scores.title}, env ${d.environmentScore})`);
    });
  }
  for (const c of FLAGGED) {
    t(`flagged: ${c.n}`, () => {
      const d = decide(c, "balanced");
      ok(d.block, `not blocked (url ${d.scores.url}, title ${d.scores.title}, env ${d.environmentScore})`);
    });
  }

  // Strict is allowed to be twitchier; it is not allowed to be unusable.
  t("strict stays under 8% false positives", () => {
    const fp = BENIGN.filter((c) => decide(c, "strict").block).length;
    ok(fp / BENIGN.length < 0.08, `strict FP ${fp}/${BENIGN.length}`);
  });
  t("lenient blocks no benign page", () => {
    eq(BENIGN.filter((c) => decide(c, "lenient").block).map((c) => c.n), []);
  });
  t("strict and balanced catch every flagged page", () => {
    eq(FLAGGED.filter((c) => !decide(c, "strict").block).map((c) => c.n), []);
  });

  return t;
}
