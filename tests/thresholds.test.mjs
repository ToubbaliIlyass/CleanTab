import { createEnv, makeTester, eq, ok, notOk } from "./harness.mjs";

export default async function () {
  const t = makeTester("sensitivity profiles");
  const { run } = createEnv();

  t("default is balanced", () => eq(run(`getProfile(undefined).label`), "Balanced"));
  t("unknown name falls back to balanced", () => eq(run(`getProfile("nonsense").label`), "Balanced"));
  t("null falls back", () => eq(run(`getProfile(null).label`), "Balanced"));
  t("DEFAULT_SENSITIVITY resolves", () => eq(run(`getProfile(DEFAULT_SENSITIVITY).label`), "Balanced"));
  t("exactly three profiles", () => eq(run(`Object.keys(SENSITIVITY_PROFILES).length`), 3));

  // Ordering invariant: a stricter profile must block on weaker evidence for EVERY
  // signal. If someone tunes one number in isolation and inverts an ordering, the
  // labels start lying to the user.
  for (const field of ["urlScore", "titleScore", "textScore", "envScore", "unsafeProb"]) {
    t(`${field}: strict <= balanced <= lenient`, () => {
      const [s, b, l] = run(
        `[getProfile("strict").${field}, getProfile("balanced").${field}, getProfile("lenient").${field}]`);
      ok(s <= b && b <= l, `strict=${s} balanced=${b} lenient=${l}`);
    });
  }

  t("safeProb goes the other way (strict demands more safety)", () => {
    const [s, l] = run(`[getProfile("strict").safeProb, getProfile("lenient").safeProb]`);
    ok(s >= l, `strict=${s} lenient=${l}`);
  });

  t("every profile has a label and blurb", () =>
    ok(run(`Object.values(SENSITIVITY_PROFILES).every(p => p.label && p.blurb)`)));

  t("probabilities stay within 0..1", () =>
    ok(run(`Object.values(SENSITIVITY_PROFILES).every(p =>
      p.unsafeProb > 0 && p.unsafeProb < 1 && p.safeProb > 0 && p.safeProb < 1)`)));

  t("lenient disables dwell scanning", () => notOk(run(`getProfile("lenient").dwell`)));
  t("balanced allows dwell scanning", () => ok(run(`getProfile("balanced").dwell`)));

  return t;
}
