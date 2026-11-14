import { createEnv, makeTester, eq, ok, notOk } from "./harness.mjs";

// Friction: nothing gets looser on a click, and a "wrong block" is decided by re-reading
// the page, words and pictures, not by the person asking.
export default async function () {
  const t = makeTester("friction + whole-page check");
  const e = createEnv({ now: new Date(2026, 8, 16, 12).getTime() });
  const run = (src) => e.run(src);
  const set = (k, v) => { e.ctx[k] = v; };

  // ── The wait ──────────────────────────────────────────────────────────────
  t("the wait doubles with every pass-through today, up to five minutes", () => {
    eq(run(`passWaitSeconds(0)`), 30);
    eq(run(`passWaitSeconds(1)`), 60);
    eq(run(`passWaitSeconds(2)`), 120);
    eq(run(`passWaitSeconds(9)`), 300);
    eq(run(`passWaitSeconds(undefined)`), 30);
  });

  // ── Who may open an unverified page ───────────────────────────────────────
  t("nothing on the adult list or the user's own blocklist can be opened", () => {
    notOk(run(`passPermission({ listed: "adult", settings: {} }).available`));
    notOk(run(`passPermission({ listed: "own", settings: {} }).available`));
  });
  t("locked hours close the way through entirely", () => {
    set("__s", { lockWindow: { enabled: true, startHour: 9, endHour: 17 } });
    const p = run(`passPermission({ listed: null, settings: __s })`);
    notOk(p.available);
    ok(/locked hours/.test(p.why));
    set("__s", { lockWindow: { enabled: true, startHour: 22, endHour: 6 } });
    ok(run(`passPermission({ listed: null, settings: __s }).available`));
  });
  t("a partner lock means the partner's passphrase is needed", () => {
    set("__s", { partnerLockHash: "abc" });
    const p = run(`passPermission({ listed: null, settings: __s })`);
    ok(p.available);
    ok(p.needsPartner);
    notOk(run(`passPermission({ listed: null, settings: {} }).needsPartner`));
  });
  t("the per-site daily cap still applies", () => {
    notOk(run(`passPermission({ listed: null, settings: {}, exhausted: true }).available`));
  });

  // ── Which sensitivity changes are loosening ───────────────────────────────
  t("only a move to a looser level is a loosening", () => {
    ok(run(`sensitivityLoosens("strict", "balanced")`));
    ok(run(`sensitivityLoosens("balanced", "lenient")`));
    notOk(run(`sensitivityLoosens("lenient", "balanced")`));
    notOk(run(`sensitivityLoosens("balanced", "strict")`));
    notOk(run(`sensitivityLoosens("balanced", "balanced")`));
  });

  // ── Reading a fetched page ────────────────────────────────────────────────
  const filler = "Tomatoes like six hours of sun and steady watering through the summer. ".repeat(10);
  const html = (body, title = "Garden notes") =>
    `<html><head><title>${title}</title><style>.x{color:red}</style><script>var porn = 1;</script></head>` +
    `<body><h1>${title}</h1><a href="/a">Read more</a>${body}</body></html>`;

  t("scripts, styles and tags are not page text", () => {
    set("__html", html(`<p>${filler}</p>`));
    const page = run(`pageFromHtml(__html, "https://example.org/a")`);
    ok(page.bodyText.includes("Tomatoes"));
    notOk(page.bodyText.includes("var porn"));
    notOk(page.bodyText.includes("<p>"));
    eq(page.titleTexts[0], "Garden notes");
    ok(page.titleTexts.includes("Read more"));
  });

  const strict = `getProfile("strict")`;
  const safeImages = `{ verdict: "safe", checked: 4, worst: 0.1 }`;

  t("clean words and clean pictures make a clean page", () => {
    set("__html", html(`<p>${filler}</p>`));
    const v = run(`(() => { const p = pageFromHtml(__html, "https://example.org/a");
      return fullReviewVerdict(decidePage(p, ${strict}), p.bodyText.length, ${safeImages}); })()`);
    eq(v.verdict, "clean");
  });
  t("explicit words are flagged even when every picture is clean", () => {
    const links = ["Free porn videos", "Hardcore porn tube", "XXX porn stream", "Watch live porn cams", "Hentai porn videos", "MILF porn videos"]
      .map((x) => `<a href="/v">${x}</a><h2>${x}</h2>`).join("");
    set("__html", html(`${links}<p>${"porn videos xxx hentai blowjob milf ".repeat(40)}</p>`, "Free porn videos xxx"));
    const v = run(`(() => { const p = pageFromHtml(__html, "https://example.org/a");
      return fullReviewVerdict(decidePage(p, ${strict}), p.bodyText.length, ${safeImages}); })()`);
    eq(v.verdict, "flagged");
    ok(/words/.test(v.reason));
  });
  t("a flagged picture is flagged whatever the words say", () => {
    eq(run(`fullReviewVerdict({ block: false }, 5000, { verdict: "unsafe", checked: 1, worst: 0.9 }).verdict`), "flagged");
  });
  t("a page with almost no text is unclear, never clean", () => {
    eq(run(`fullReviewVerdict({ block: false }, 40, ${safeImages}).verdict`), "unclear");
  });
  t("too few readable pictures is unclear, never clean", () => {
    eq(run(`fullReviewVerdict({ block: false }, 5000, { verdict: "inconclusive", checked: 1, worst: 0 }).verdict`), "unclear");
  });
  t("a page that could not be fetched is unclear", () => {
    eq(run(`fullReviewVerdict(null, 0, { verdict: "inconclusive", checked: 0, worst: 0 }).verdict`), "unclear");
  });

  return t;
}
