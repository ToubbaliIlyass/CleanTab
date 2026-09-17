import { createEnv, makeTester, eq, ok, close } from "./harness.mjs";

export default async function () {
  const t = makeTester("URL + risk scoring");
  const { run } = createEnv();
  const url = (u) => run(`getURLScore(${JSON.stringify(u)})`);

  // ── The Google sign-in regression ──────────────────────────────────────────
  // ?continue= carries a passthrough destination, not user intent. Scoring its value
  // made login pages inherit the score of wherever they were sending you.
  t("?continue= is not scored", () =>
    eq(url("https://accounts.google.com/signin?continue=https://example.com/porn"), 0));
  t("?redirect_uri= is not scored", () =>
    eq(url("https://auth.example.com/?redirect_uri=https%3A%2F%2Fx.com%2Fnsfw"), 0));
  t("?state= is not scored", () =>
    eq(url("https://oauth.example.com/?state=nsfw"), 0));
  t("passthrough keys are matched case-insensitively", () =>
    eq(url("https://x.com/?ReturnTo=porn"), 0));

  // ── Real intent still scores ───────────────────────────────────────────────
  t("a non-passthrough query value scores at 1.5x", () =>
    close(url("https://example.com/?q=porn"), 5 * 1.5, 1e-9));
  t("a keyword in the path scores", () => eq(url("https://example.com/porn/videos"), 5));
  t("path and query stack", () =>
    close(url("https://example.com/porn?q=hentai"), 5 + 5 * 1.5, 1e-9));

  t("innocent URLs score 0", () => eq(url("https://en.wikipedia.org/wiki/Camera"), 0));
  t("a Cambridge URL scores 0", () => eq(url("https://cambridge.org/press"), 0));
  t("a Google search for camera scores 0", () =>
    eq(url("https://www.google.com/search?q=best+camera+2026"), 0));

  t("uppercase URLs still score", () => eq(url("https://EXAMPLE.com/PORN"), 5));

  // ── Robustness ─────────────────────────────────────────────────────────────
  t("malformed URL does not throw", () => ok(url("not a url") === 0));
  t("malformed URL still scores its text", () => eq(url("garbage porn garbage"), 5));
  t("empty string", () => eq(url(""), 0));
  t("a hash fragment is part of the string", () => eq(url("https://x.com/#porn"), 5));

  // ── riskLevel ──────────────────────────────────────────────────────────────
  const risk = (s) => run(`riskLevel(${JSON.stringify(s)}, getProfile("balanced"))`);
  t("nothing scored → 0", () => eq(risk({ url: 0, title: 0, text: 0 }), 0));
  t("at the threshold → 5", () => eq(risk({ url: 5, title: 0, text: 0 }), 5));
  t("over the threshold clamps to 5", () => eq(risk({ url: 50, title: 0, text: 0 }), 5));
  t("half the threshold → mid scale", () => eq(risk({ url: 2.5, title: 0, text: 0 }), 3));
  t("takes the strongest signal", () => eq(risk({ url: 0, title: 6, text: 0 }), 5));
  t("missing fields are treated as 0", () => eq(risk({}), 0));
  t("never returns negative", () => ok(risk({ url: -10, title: 0, text: 0 }) >= 0));

  // A stricter profile must report the same raw score as riskier.
  t("strict profile reports higher risk than lenient for the same score", () => {
    const strict = run(`riskLevel({url:3,title:0,text:0}, getProfile("strict"))`);
    const lenient = run(`riskLevel({url:3,title:0,text:0}, getProfile("lenient"))`);
    ok(strict > lenient, `strict=${strict} lenient=${lenient}`);
  });

  return t;
}
