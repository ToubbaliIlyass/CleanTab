// The page decision, as a pure function. content.js gathers the page's visible text into
// plain arrays and calls decidePage(); nothing here touches the DOM, so the same logic
// can be run over a corpus of benign and flagged pages in the test suite
// (tests/corpus.test.mjs). That corpus exists because this is the code that decides
// whether someone is stopped, and it regresses silently.

// ── Environment keyword clusters ──────────────────────────────────────────────

// Matched with word boundaries. Strong anchors are words with no everyday reading;
// weak anchors are words that are also names, art and shopping terms ("cam", "nude").
const adultAnchorStrong = [
  "porn", "nsfw", "xxx", "hentai", "blowjob", "bdsm", "milf", "onlyfans", "camgirl",
  "creampie", "gangbang",
];
const adultAnchorWeak = ["cam", "cams", "nude", "naked", "nudes"];

const adultContextWords = [
  "model", "models", "private", "room", "girls", "chat", "show", "studio",
];

const mediaWords = ["video", "videos", "live", "stream", "watch"];

function boundaryRegex(word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i");
}

const anchorStrongRegexes = adultAnchorStrong.map(boundaryRegex);
const anchorWeakRegexes = adultAnchorWeak.map(boundaryRegex);
const adultContextRegexes = adultContextWords.map(boundaryRegex);
const mediaRegexes = mediaWords.map(boundaryRegex);

// ── Scoring over collected text ───────────────────────────────────────────────

// Heading, title and link texts. Capped and de-duplicated: the same word repeated in a
// hundred list items is one signal, not a hundred.
function titleScoreOf(texts) {
  let score = 0;
  const seen = new Set();
  const max = Math.min(texts.length, 50);
  for (let i = 0; i < max; i++) {
    const text = String(texts[i] || "").toLowerCase();
    if (!text || text.length > 200 || seen.has(text)) continue;
    seen.add(text);
    score += getKeywordScore(text) * 1.5;
    if (score >= 15) break;
  }
  return score;
}

// How adult the surrounding site looks. Every DISTINCT anchor word counts once, however
// many elements repeat it, and the repeat bonus is small and capped. Counting each
// element separately let any long page, a social feed or a forum with a "NSFW" tag on
// every post, climb past the threshold just by being long.
function environmentScoreOf(texts) {
  const strong = new Set();
  const weak = new Set();
  let anchorElements = 0;
  let context = 0;
  const seen = new Set();

  for (const raw of texts) {
    const text = String(raw || "").toLowerCase();
    if (!text || text.length > 300 || seen.has(text)) continue;
    seen.add(text);

    let hit = false;
    anchorStrongRegexes.forEach((r, i) => { if (r.test(text)) { strong.add(i); hit = true; } });
    anchorWeakRegexes.forEach((r, i) => { if (r.test(text)) { weak.add(i); hit = true; } });
    if (hit) anchorElements += 1;
    // Context and media words amplify, but only on elements that carry an anchor.
    if (hit) {
      adultContextRegexes.forEach((r) => { if (r.test(text)) context += 1; });
      mediaRegexes.forEach((r) => { if (r.test(text)) context += 1; });
    }
  }

  // Weak anchors ("cam", "nude", "naked") are also paint shades, art and names. They only
  // amplify an environment that already has a strong anchor; they never make one.
  if (!strong.size) return 0;
  const score = strong.size * 3 + weak.size * 1.5 +
    Math.min(anchorElements, 6) * 0.5 + Math.min(context, 4) * 0.5;
  return score;
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

// ── The decision ──────────────────────────────────────────────────────────────

// input: { url, bodyText, titleTexts[], envTexts[] }
// Returns { block: bool, reason, scores, risk }.
function decidePage(input, profile) {
  const url = input.url;
  const onYouTube = isYouTube(url);
  const textScannable = allowsTextScan(url);

  const evidence = onYouTube ? null : textEvidence(input.bodyText || "");
  const scores = {
    url: getURLScore(url),
    text: evidence ? evidence.score : 0,
    title: titleScoreOf(input.titleTexts || []),
  };
  const environmentScore = environmentScoreOf(input.envTexts || []);
  const riskyEnvironment = environmentScore >= profile.envScore;
  const out = (block, reason) => ({ block, reason, scores, evidence, environmentScore });

  // Known adult domains (registrable-domain or subdomain match, never a substring).
  if (isKnownAdultDomain(hostOf(url))) return out(true, "This site is on the adult-site list");

  // 1. Strong URL intent. A search query is something someone typed, so it counts on its
  // own. A topic in the PATH ("/news/porn-industry-report") is only a topic: it blocks
  // only when the page itself also looks adult (environment, headings or dense text).
  if (urlBlocksPage(
    scores.url, evidence, profile, urlScoreFromQuery(url), queryIsHelpSeeking(url),
  )) {
    const corroborated = riskyEnvironment || textBlocksPage(evidence, profile);
    if (urlScoreFromQuery(url) || corroborated) {
      return out(true, "Search or link contained high-risk keywords");
    }
  }

  const titleBar = onYouTube ? profile.titleScore * 1.5 : profile.titleScore;

  // 2. Explicit destination sites.
  if (riskyEnvironment && !isHomeFeed(url) && scores.title >= titleBar) {
    return out(true, "Explicit titles detected across page");
  }

  // 3. Adult environment plus explicit content.
  if (
    riskyEnvironment && textScannable && !onYouTube &&
    (textBlocksPage(evidence, profile) || scores.title >= profile.titleScore - 2)
  ) {
    return out(true, "Adult environment + explicit content detected");
  }

  return out(false, "");
}
