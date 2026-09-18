// Discussion vs hosting — telling a page ABOUT explicit content from a page OF it.
//
// This suite exists because of a shipped regression. Once text scanning widened to every
// non-feed page, CleanTab blocked its own landing page, and with it the whole class of
// commentary: news reporting, research, sexual-health writing, and recovery resources.
// That last one is the serious failure — someone using this to quit needs to be able to
// read about quitting.
//
// The rule under test: a TEXT-ONLY block needs keyword density, and commentary
// vocabulary suppresses it. Title, URL and image evidence are deliberately untouched, so
// a page full of explicit headings still blocks whatever its prose says about itself.

import { createEnv, makeTester, eq, ok, notOk } from "./harness.mjs";

export default async function () {
  const t = makeTester("discussion vs hosting");
  const { run } = createEnv();

  const blocks = (text, profile = "balanced") =>
    run(`textBlocksPage(textEvidence(${JSON.stringify(text)}), getProfile("${profile}"))`);
  const ev = (text) => run(`textEvidence(${JSON.stringify(text)})`);

  // ── The page that caught this ──────────────────────────────────────────────
  const CLEANTAB_COPY = `
    Most porn blockers treat you like a problem to be locked out. CleanTab treats you
    like a person trying to do better. Hard to remove, kind when it catches you.
    CleanTab is a browser extension that detects NSFW content locally and pauses the
    tab. Open source, MIT licensed, and there is a privacy policy on the site.
    Does it work on YouTube, Twitter or Reddit? Yes, and on every other site.
    Is CleanTab tamper-proof? Only when force-installed by admin policy.
    Recovery is hard and a blocker alone will not fix addiction — set up DNS filtering
    and OS parental controls as well. Research on compulsive use is contested.
  `;
  t("CleanTab's own landing copy does not block", () => notOk(blocks(CLEANTAB_COPY)));

  t("its own repository README does not block", () =>
    notOk(blocks(`
      CleanTab detects NSFW content and redirects you to a pause screen. Word-boundary
      keyword scoring, URL parameter analysis, and local image classification. This
      browser extension is open source and MIT licensed. See the privacy policy.
      Detection misfires on health writing and art; every block has a way through.
    `)));

  // ── Commentary that must stay reachable ────────────────────────────────────
  const COMMENTARY = {
    "news reporting": `
      A new study of compulsive porn use surveyed two thousand adults. Researchers found
      the addiction framing is contested among therapists. Prevention and education,
      the authors argue, matter more than blocking software or parental controls.
      Critics say the statistics are weak and the survey design flawed.`,
    "recovery resource": `
      Quitting porn is hard and relapse is normal. Recovery is not a straight line.
      An accountability partner helps more than a blocker alone. If compulsive use is
      interfering with your life, talk to a therapist — support groups exist and
      counselling works for many people. Abstinence is a means, not the goal.`,
    "sexual health": `
      Sexual health advice for adults. Talk to your doctor about safe sex and
      contraception. A clinic can test for symptoms without judgement. Reproductive
      anatomy is taught badly in most schools, so this guide covers the medical basics.`,
    "art history": `
      The nude in Western art history. This gallery exhibition traces the naked figure
      from antiquity to modernism. The museum's curriculum notes discuss how students
      should read the erotic in classical sculpture.`,
    "review of blockers": `
      We tested every porn blocker for Chrome. Most are filtering proxies that break
      pages. Our review covers the extension permissions each one requests, whether
      the filter runs locally, and how the parental controls compare. Open source
      options score best on privacy.`,
  };
  for (const [name, text] of Object.entries(COMMENTARY)) {
    t(`${name} does not block`, () => notOk(blocks(text), `${name} must stay reachable`));
  }

  // ── Hosting pages must still block ─────────────────────────────────────────
  const HOSTING = {
    "tube front page": `
      Free porn videos. Hot nude teen xxx. Watch hardcore hentai porn tube. Best porn
      sites. Nude cams live. Free xxx porn videos hd. Naked girls porn. Amateur porn.
      Milf porn videos xxx nude. Creampie gangbang porn.`,
    "short hosting page": `Free porn. Nude xxx. Hentai porn tube. Naked milf xxx.`,
    "category listing": `
      Porn categories: anal, milf, hentai, bdsm. Nude teen xxx videos. Hardcore porn.
      Naked amateur. Free xxx tube. Blowjob porn videos.`,
  };
  for (const [name, text] of Object.entries(HOSTING)) {
    t(`${name} blocks`, () => ok(blocks(text), `${name} must block`));
  }

  // A hosting page cannot buy immunity by sprinkling commentary vocabulary — past a
  // density no article reaches, the suppressor stops applying.
  t("commentary words do not rescue a dense hosting page", () =>
    ok(blocks(`
      Free porn videos xxx nude hentai hardcore milf naked porn tube xxx porn.
      Use our filter. Browser extension available. Open source. Privacy policy.
      Research. Education. Parental controls.
    `)));

  // ── Density is the mechanism ───────────────────────────────────────────────
  // Presence-based scoring gave one mention in a long essay the same weight as a tube
  // site's front page. That is what this fixes.
  t("one mention in a long essay does not block", () => {
    const essay = "the history of media regulation is long. ".repeat(80) +
      "critics cite porn as an example.";
    notOk(blocks(essay));
  });

  t("the same mention in a short page does block", () =>
    ok(blocks("porn xxx nude hentai")));

  t("density is reported per thousand words", () => {
    const e = ev("porn " + "word ".repeat(999));
    ok(e.density > 0.5 && e.density < 1.5, `expected ~1 per 1000, got ${e.density}`);
  });

  t("occurrences are counted, not just presence", () => {
    eq(ev("porn porn porn").occurrences, 3);
    eq(ev("porn porn porn").score, 5); // score stays presence-based
  });

  t("an empty page is inert", () => {
    const e = ev("");
    eq(e.density, 0);
    eq(e.occurrences, 0);
    notOk(blocks(""));
  });

  t("null evidence never blocks", () =>
    notOk(run(`textBlocksPage(null, getProfile("balanced"))`)));

  // ── Sensitivity still matters ──────────────────────────────────────────────
  // "sex" scores 3: at balanced's threshold, below lenient's 5.
  t("a weak signal blocks on balanced but not lenient", () => {
    const text = "sex sex sex sex";
    ok(blocks(text, "balanced"));
    notOk(blocks(text, "lenient"));
  });

  t("strict is not more permissive than balanced", () => {
    const text = "sex sex sex sex";
    ok(blocks(text, "strict"));
  });

  // The override needs saturation, not just density. Short commentary is dense by
  // nature and must not be caught by it.
  t("a short dense commentary passage is not treated as saturated", () => {
    const e = ev("The nude and naked figure in erotic classical art history exhibition.");
    ok(e.density >= 60, "short passages are dense by construction");
    ok(e.occurrences < 8, "but not saturated");
  });

  // ── Rule 1: query intent vs topic slug ─────────────────────────────────────
  //
  // The URL rule fires before any text is considered, so the commentary suppression
  // above never ran for it. A news article at /article/porn-addiction-study scores 5 on
  // the path alone and was blocked outright — the exact class the suppression exists to
  // protect, reached by a different door.

  const urlBlocks = (url, text) => run(`
    urlBlocksPage(
      getURLScore(${JSON.stringify(url)}),
      textEvidence(${JSON.stringify(text)}),
      getProfile("balanced"),
      urlScoreFromQuery(${JSON.stringify(url)})
    )`);

  const COMMENTARY_TEXT = `
    A new study of compulsive porn use surveyed two thousand adults. Researchers found
    the addiction framing is contested among therapists. Prevention and education matter
    more than blocking software or parental controls.`;

  t("a typed search query still blocks", () =>
    ok(urlBlocks("https://www.google.com/search?q=porn", "")));

  t("a search query blocks even on a commentary-looking page", () =>
    ok(urlBlocks("https://www.google.com/search?q=porn", COMMENTARY_TEXT),
      "someone typed this; the page's own words do not excuse it"));

  t("a topic slug on a commentary page does not block", () =>
    notOk(urlBlocks("https://news.example.com/article/porn-addiction-study", COMMENTARY_TEXT)));

  t("a topic slug on a saturated page still blocks", () =>
    ok(urlBlocks("https://freetube.example/porn/videos",
      "Free porn videos nude xxx hentai hardcore milf naked porn tube xxx porn nude cams.")));

  t("a topic slug with no commentary still blocks", () =>
    ok(urlBlocks("https://example.com/porn/", "")));

  t("query detection ignores passthrough params", () =>
    notOk(run(`urlScoreFromQuery("https://accounts.google.com/signin?continue=https://x.com/porn")`),
      "the passthrough skip list must apply here too"));

  t("an unparseable url has no query score", () =>
    notOk(run(`urlScoreFromQuery("not a url")`)));

  // ── Help-seeking queries ───────────────────────────────────────────────────
  //
  // The worst false positive this product can have. "porn" and "how to stop watching
  // porn" contain the same keyword; only the purpose differs, so scoring cannot
  // separate them. Blocking the second one means the tool someone installed to quit
  // blocks their search for help quitting.

  const searchBlocks = (q) => {
    const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
    return run(`
      urlBlocksPage(
        getURLScore(${JSON.stringify(url)}),
        textEvidence(""),
        getProfile("balanced"),
        urlScoreFromQuery(${JSON.stringify(url)}),
        queryIsHelpSeeking(${JSON.stringify(url)})
      )`);
  };

  for (const q of [
    "how to stop watching porn",
    "how do i quit porn",
    "porn addiction help",
    "quit porn support group",
    "nofap porn recovery",
    "is porn bad for you",
    "effects of porn on the brain",
    "porn addiction statistics",
    "does porn affect relationships",
    "porn blocker for chrome",
    "porn addiction therapist",
  ]) {
    t(`help-seeking: "${q}" is not blocked`, () =>
      notOk(searchBlocks(q), "searching for a way out must never be blocked"));
  }

  for (const q of ["porn", "free porn videos", "hentai", "best porn sites", "xxx videos"]) {
    t(`seeking content: "${q}" still blocks`, () => ok(searchBlocks(q)));
  }

  // A search results page is not itself explicit; the destination is scanned on its own
  // merits. That is what makes letting these through cheap.
  t("help markers do not leak into page-body scoring", () => {
    // "quit" and "help" are help markers but must not suppress a dense hosting page.
    ok(blocks("Free porn videos xxx nude hentai milf naked porn tube. Quit? Help."));
  });

  t("an unparseable url is not treated as help-seeking", () =>
    notOk(run(`queryIsHelpSeeking("not a url")`)));

  t("help markers are read from query values, not the path", () =>
    notOk(run(`queryIsHelpSeeking("https://example.com/how-to-stop-watching-porn")`),
      "a path slug is handled by the commentary rule instead"));

  return t;
}
