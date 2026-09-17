// Page review helpers — the appeal path's "is this site actually explicit?" check.
//
// Parsing is separated from fetching so the parse can be tested without a network or a
// browser. The appeal is the single most consequential decision CleanTab makes (it grants
// permanent trust), and its previous implementation was silently reading the wrong page.

const REVIEW_MAX_IMAGES = 8;
const REVIEW_MIN_FOR_CLEAR = 3;
const REVIEW_MAX_HTML_BYTES = 2_000_000; // don't regex across a 50 MB page

function parseImageUrls(html, pageUrl, max = REVIEW_MAX_IMAGES) {
  const source = html.length > REVIEW_MAX_HTML_BYTES
    ? html.slice(0, REVIEW_MAX_HTML_BYTES)
    : html;

  const urls = new Set();

  const push = (raw) => {
    if (!raw) return;
    // Unrendered template placeholders ({{x}}, {%x%}, ${x}) resolve as perfectly valid
    // relative URLs, so the parser would happily queue them for fetching. Server-rendered
    // HTML from client-side frameworks is full of them.
    if (/[{}]|\$\{|\s/.test(raw.trim())) return;
    try {
      const abs = new URL(raw, pageUrl);
      // SVGs are almost always icons and chrome, and the classifier can't read them.
      if (abs.protocol !== "http:" && abs.protocol !== "https:") return;
      if (abs.pathname.toLowerCase().endsWith(".svg")) return;
      urls.add(abs.href);
    } catch {
      // Unparseable src — skip it rather than failing the whole review.
    }
  };

  for (const m of source.matchAll(/<img[^>]+?src=["']([^"']+)["']/gi)) push(m[1]);
  for (const m of source.matchAll(/<meta[^>]+?property=["']og:image["'][^>]*?content=["']([^"']+)["']/gi)) push(m[1]);
  for (const m of source.matchAll(/<meta[^>]+?content=["']([^"']+)["'][^>]*?property=["']og:image["']/gi)) push(m[1]);

  return [...urls].slice(0, max);
}

// Turns per-image predictions into one of three outcomes. "inconclusive" exists because a
// client-rendered page exposes few images to a plain fetch — and answering that with a
// clear, as the old flow did, is how a permanent bypass gets handed out by accident.
function reviewVerdict(predictions, profile) {
  let checked = 0;
  let worst = 0;

  for (const p of predictions) {
    if (!p) continue;
    checked += 1;
    worst = Math.max(worst, (p.porn || 0) + (p.hentai || 0) + (p.sexy || 0));
    if (worst > profile.unsafeProb) return { verdict: "unsafe", checked, worst };
  }

  if (checked >= REVIEW_MIN_FOR_CLEAR) return { verdict: "safe", checked, worst };
  return { verdict: "inconclusive", checked, worst };
}
