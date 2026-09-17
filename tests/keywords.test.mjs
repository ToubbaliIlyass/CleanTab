import { createEnv, makeTester, eq, ok } from "./harness.mjs";

export default async function () {
  const t = makeTester("keyword scoring");
  const { run } = createEnv();
  const score = (s) => run(`getKeywordScore(${JSON.stringify(s)})`);

  // ── False positives: the Scunthorpe class ──────────────────────────────────
  // Every one of these scored before word-boundary regexes landed (plan §Phase 1).
  const innocent = [
    "camera", "cameras", "webcamera", "camaraderie",
    "essex", "sussex", "middlesex", "unisex", "sextet", "sexagenarian",
    "cambridge", "scampi", "scam", "camper", "campaign",
    "denude", "nudge", "prudence",
    "thirsty", "shirt", "explicitly stated",
    "a photo of a camel in cambridge",
  ];
  for (const word of innocent) {
    t(`"${word}" scores 0`, () => eq(score(word), 0));
  }

  // ── True positives ─────────────────────────────────────────────────────────
  t("porn scores 5", () => eq(score("porn"), 5));
  t("nsfw scores 5", () => eq(score("nsfw"), 5));
  t("hentai scores 5", () => eq(score("hentai"), 5));
  t("nude scores 3", () => eq(score("nude"), 3));
  t("sexy scores 2", () => eq(score("sexy"), 2));
  t("18+ scores 3", () => eq(score("18+ only"), 3));

  t("case insensitive", () => eq(score("PORN"), 5));
  t("matches inside a sentence", () => eq(score("this is nsfw content"), 5));
  t("matches with punctuation around it", () => eq(score("warning: porn!"), 5));

  // ── Accumulation ───────────────────────────────────────────────────────────
  t("distinct keywords add up", () => eq(score("porn and hentai"), 10));
  t("a repeated keyword counts once", () => eq(score("porn porn porn"), 5),
    // Scores are per-keyword presence, not per-occurrence. Worth pinning: a page that
    // says "sex" forty times should not outrank a page that says "porn" once.
  );

  // ── Boundary behaviour for non-word-ending keywords ─────────────────────────
  t("cam matches standalone", () => ok(score("cam") > 0));
  t("cam does not match camera", () => eq(score("camera"), 0));
  t("sex matches standalone", () => ok(score("sex") > 0));
  t("sex does not match sexual", () => eq(score("sexual health"), 0));

  t("empty string", () => eq(score(""), 0));

  // ── The anatomy / act tier ─────────────────────────────────────────────────
  // The list originally held 22 entries and none of these. A YouTube search for
  // "sexy girls naked" scored 3 against a threshold of 5, because "naked" was not a
  // keyword at all and "sexy" (2) could not carry the query multiplier alone.
  t("naked scores", () => ok(score("naked") >= 3));
  t("nudes scores — \\bnude\\b does not match it", () => ok(score("nudes") >= 3));
  t("milf scores high", () => eq(score("milf"), 5));
  t("striptease scores high", () => eq(score("striptease"), 5));
  for (const w of ["tits", "boobs", "pussy", "anal", "erotic", "fetish",
                   "masturbation", "escort", "creampie", "gangbang", "rule34"]) {
    t(`"${w}" scores`, () => ok(score(w) > 0, `${w} must score`));
  }

  // Boundary anchoring has to survive the additions — these are the new Scunthorpes.
  const newInnocent = [
    "analysis", "analyse", "canal", "pussycat", "cocktail", "cockpit", "peacock",
    "escorted", "stripe", "stripped", "hornywort", "fingerprint", "thongs of steel",
    "naked-eye astronomy is a hobby",
  ];
  for (const word of newInnocent) {
    // "naked-eye" is a real phrase but "naked" is a genuine keyword hit; assert only
    // that the purely-innocent substrings stay at zero.
    if (word.includes("naked") || word.includes("thong")) continue;
    t(`"${word}" scores 0`, () => eq(score(word), 0));
  }

  // ── The list itself ────────────────────────────────────────────────────────
  // A lower bound, not an exact count: pinning the exact number meant every legitimate
  // addition to the list failed the suite for no reason.
  t("one keyword list exists", () => ok(run(`Object.keys(keywordWeights).length`) >= 22));
  t("keywords are lowercase and unique", () => {
    const keys = run(`Object.keys(keywordWeights)`);
    eq(keys.filter((k) => k !== k.toLowerCase()), []);
    eq(keys.length, new Set(keys).size);
  });
  t("known adult domains list is present", () => ok(run(`knownAdultDomains.size >= 13`)));
  t("adult domains are stored normalized", () =>
    ok(run(`[...knownAdultDomains].every(d => d === d.toLowerCase() && !d.startsWith("www."))`)));

  return t;
}
