import { createEnv, makeTester, eq, ok } from "./harness.mjs";

export default async function () {
  const t = makeTester("appeal page review");
  const { run } = createEnv();
  const parse = (html, base = "https://example.com/page") =>
    run(`parseImageUrls(${JSON.stringify(html)}, ${JSON.stringify(base)})`);

  // ── parseImageUrls ─────────────────────────────────────────────────────────
  t("finds a basic img src", () =>
    eq(parse(`<img src="https://cdn.example.com/a.jpg">`), ["https://cdn.example.com/a.jpg"]));

  t("resolves a root-relative src", () =>
    eq(parse(`<img src="/img/a.jpg">`), ["https://example.com/img/a.jpg"]));

  t("resolves a document-relative src", () =>
    eq(parse(`<img src="a.jpg">`), ["https://example.com/a.jpg"]));

  t("handles single quotes", () =>
    eq(parse(`<img src='https://cdn.example.com/a.jpg'>`), ["https://cdn.example.com/a.jpg"]));

  t("handles attributes before src", () =>
    eq(parse(`<img class="x" data-y="1" src="https://cdn.example.com/a.jpg">`),
       ["https://cdn.example.com/a.jpg"]));

  t("finds og:image (property first)", () =>
    eq(parse(`<meta property="og:image" content="https://cdn.example.com/og.jpg">`),
       ["https://cdn.example.com/og.jpg"]));

  t("finds og:image (content first)", () =>
    eq(parse(`<meta content="https://cdn.example.com/og.jpg" property="og:image">`),
       ["https://cdn.example.com/og.jpg"]));

  t("deduplicates identical URLs", () =>
    eq(parse(`<img src="/a.jpg"><img src="/a.jpg"><img src="https://example.com/a.jpg">`),
       ["https://example.com/a.jpg"]));

  t("skips SVGs", () => eq(parse(`<img src="/icon.svg">`), []));
  t("skips data: URIs", () => eq(parse(`<img src="data:image/png;base64,AAA">`), []));
  t("skips blob: URIs", () => eq(parse(`<img src="blob:https://example.com/xyz">`), []));
  t("skips unparseable srcs", () => eq(parse(`<img src="{{ template }}">`), []));

  t("caps the number of images", () => {
    const html = Array.from({ length: 30 }, (_, i) => `<img src="/i${i}.jpg">`).join("");
    eq(parse(html).length, 8);
  });

  t("respects an explicit cap", () => {
    const html = Array.from({ length: 30 }, (_, i) => `<img src="/i${i}.jpg">`).join("");
    eq(run(`parseImageUrls(${JSON.stringify(html)}, "https://example.com/", 3).length`), 3);
  });

  t("empty HTML yields nothing", () => eq(parse(""), []));
  t("HTML with no images yields nothing", () => eq(parse("<p>hello</p>"), []));

  t("does not hang on a very large document", () => {
    const html = "<p>x</p>".repeat(400000) + `<img src="/late.jpg">`;
    const started = Date.now();
    const out = parse(html);
    ok(Date.now() - started < 5000, "parse took too long");
    // The late image falls outside the byte cap — that's the documented tradeoff.
    ok(Array.isArray(out));
  });

  // ── reviewVerdict ──────────────────────────────────────────────────────────
  const verdict = (preds) =>
    run(`reviewVerdict(${JSON.stringify(preds)}, getProfile("balanced"))`);

  const SAFE = { neutral: 0.97, drawing: 0.01, porn: 0.01, hentai: 0.005, sexy: 0.005 };
  const EXPLICIT = { neutral: 0.05, drawing: 0.02, porn: 0.9, hentai: 0.02, sexy: 0.01 };

  t("one explicit image is unsafe", () => eq(verdict([EXPLICIT]).verdict, "unsafe"));
  t("explicit wins over safe images", () =>
    eq(verdict([SAFE, SAFE, EXPLICIT, SAFE]).verdict, "unsafe"));

  t("three safe images clear", () => eq(verdict([SAFE, SAFE, SAFE]).verdict, "safe"));
  t("four safe images clear", () => eq(verdict([SAFE, SAFE, SAFE, SAFE]).verdict, "safe"));

  // The old flow's failure mode was clearing on insufficient evidence. It must not.
  t("two safe images is inconclusive, not safe", () =>
    eq(verdict([SAFE, SAFE]).verdict, "inconclusive"));
  t("zero images is inconclusive", () => eq(verdict([]).verdict, "inconclusive"));
  t("all-failed fetches are inconclusive", () =>
    eq(verdict([null, null, null, null]).verdict, "inconclusive"));
  t("nulls do not count toward the clear threshold", () =>
    eq(verdict([SAFE, null, SAFE, null]).verdict, "inconclusive"));

  t("reports how many were checked", () => eq(verdict([SAFE, SAFE, SAFE]).checked, 3));
  t("reports the worst score seen", () => ok(verdict([SAFE, EXPLICIT]).worst > 0.9));

  // A stricter profile flags what balanced lets pass.
  const BORDERLINE = { neutral: 0.45, drawing: 0.05, porn: 0.2, hentai: 0.1, sexy: 0.2 };
  t("borderline: balanced clears, strict flags", () => {
    const b = run(`reviewVerdict(${JSON.stringify([BORDERLINE, BORDERLINE, BORDERLINE])}, getProfile("balanced")).verdict`);
    const s = run(`reviewVerdict(${JSON.stringify([BORDERLINE, BORDERLINE, BORDERLINE])}, getProfile("strict")).verdict`);
    eq([b, s], ["safe", "unsafe"]);
  });

  return t;
}
