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
// NSFW.js's "sexy" class is the model's catch-all for swimwear, gym photos, fashion,
// skin-toned objects and fine art. It counts at half weight; "porn" and "hentai" count in
// full. Used by the dwell scanner and the appeal review alike so they cannot disagree.
const SEXY_CLASS_WEIGHT = 0.5;

function predictionUnsafeScore(prediction) {
  if (!prediction) return 0;
  return (prediction.porn || 0) + (prediction.hentai || 0) +
    SEXY_CLASS_WEIGHT * (prediction.sexy || 0);
}

function reviewVerdict(predictions, profile) {
  let checked = 0;
  let worst = 0;

  for (const p of predictions) {
    if (!p) continue;
    checked += 1;
    worst = Math.max(worst, predictionUnsafeScore(p));
    if (worst > profile.unsafeProb) return { verdict: "unsafe", checked, worst };
  }

  if (checked >= REVIEW_MIN_FOR_CLEAR) return { verdict: "safe", checked, worst };
  return { verdict: "inconclusive", checked, worst };
}

// ── The whole page, not just its pictures ─────────────────────────────────────
//
// A page can be explicit in words alone. So "is this block wrong?" is answered from both:
// the page's text, run through the same rules that block pages (at the strictest
// profile, because this is the moment someone is asking to be let through), and its
// images. Clean means both were actually read and neither found anything.

const REVIEW_MIN_TEXT = 400; // characters of readable text before "nothing found" counts

function stripTags(fragment) {
  return String(fragment || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(nbsp|amp|quot|#39|lt|gt|#x27|apos);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Fetched HTML -> the { url, bodyText, titleTexts, envTexts } shape decidePage() takes.
// A regex pass, not a DOM: the worker has none, and this only needs the words.
function pageFromHtml(html, url) {
  const source = String(html || "").slice(0, REVIEW_MAX_HTML_BYTES)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ");

  const grab = (tag, limit) => {
    const out = [];
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
    for (const m of source.matchAll(re)) {
      const text = stripTags(m[1]);
      if (text && text.length <= 300) out.push(text);
      if (out.length >= limit) break;
    }
    return out;
  };

  const title = stripTags((source.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const headings = [...grab("h1", 20), ...grab("h2", 30), ...grab("h3", 30)];
  const links = grab("a", 400);
  const body = (source.match(/<body[^>]*>([\s\S]*)/i) || [null, source])[1];

  return {
    url,
    bodyText: stripTags(body),
    titleTexts: [title, ...headings, ...links].filter(Boolean).slice(0, 50),
    envTexts: [...headings, ...links, ...grab("button", 100), ...grab("span", 800), ...grab("label", 100)],
  };
}

// "clean" | "flagged" | "unclear", with a sentence for the pause page.
//   textDecision  decidePage() result for the fetched page
//   textLength    how much readable text there was
//   images        reviewVerdict() result
function fullReviewVerdict(textDecision, textLength, images) {
  if (images.verdict === "unsafe") {
    return { verdict: "flagged", reason: "The pictures on this page were flagged." };
  }
  if (textDecision && textDecision.block) {
    return { verdict: "flagged", reason: "The words on this page were flagged." };
  }
  if (textLength < REVIEW_MIN_TEXT || images.verdict !== "safe") {
    return {
      verdict: "unclear",
      reason: "There wasn't enough on this page to check. It may load its content after opening.",
    };
  }
  return {
    verdict: "clean",
    reason: `Checked the text and ${images.checked} picture${images.checked === 1 ? "" : "s"}. Nothing flagged.`,
  };
}
