// URL and risk scoring. Lives here rather than in content.js so it is reachable from the
// test suite — this is the code path that produced the Google-sign-in false positive, and
// it is exactly the kind of logic that regresses silently.

// Params that carry a passthrough URL rather than user intent. Scoring the value of
// ?continue=https://...  meant a Google login page inherited the score of wherever it was
// sending you.
const PASSTHROUGH_PARAMS = new Set([
  "continue", "redirect_uri", "redirect", "next", "return_to",
  "returnto", "state", "url", "dest", "destination", "goto",
]);

function getURLScore(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    // Unparseable — fall back to scoring the raw string. Nothing to exclude.
    return getKeywordScore(String(url).toLowerCase());
  }

  // Score the host, path and fragment — but NOT the raw query string.
  //
  // Scoring the whole href first defeated the passthrough skip list entirely: a Google
  // sign-in URL carrying ?continue=https://site/porn scored on "porn" from the full-string
  // pass before the loop below ever got to skip it. The skip list only works if the
  // excluded values were never in the scored text to begin with.
  let score = getKeywordScore(
    `${parsed.hostname}${parsed.pathname}${parsed.hash}`.toLowerCase(),
  );

  for (const [key, value] of parsed.searchParams.entries()) {
    if (PASSTHROUGH_PARAMS.has(key.toLowerCase())) continue;
    // Query values are stronger intent than path segments — someone typed this.
    score += getKeywordScore(`${key} ${value || ""}`.toLowerCase()) * 1.5;
  }

  return score;
}

// Normalized 0–5 risk for the popup's current-site card. Detection used to be entirely
// opaque — you could not tell from outside whether CleanTab was doing anything at all.
function riskLevel(scores, profile) {
  const ratio = Math.max(
    (scores.url || 0) / profile.urlScore,
    (scores.title || 0) / profile.titleScore,
    (scores.text || 0) / profile.textScore,
  );
  return Math.max(0, Math.min(5, Math.round(ratio * 5)));
}


// ── Discussion vs hosting ─────────────────────────────────────────────────────
//
// The detector could not tell a page that *discusses* explicit content from one that
// *hosts* it. Once text scanning widened to every non-feed page, that gap became a
// live bug: CleanTab blocked its own landing page, its own repository, news reporting
// on porn addiction, and recovery resources. The last of those is the worst — someone
// using this to quit needs to be able to read about quitting.
//
// Two signals separate the two cases, and a text-only block now requires both.

// Vocabulary of commentary, research, recovery and tooling. A hosting page has no
// reason to use it; an article about the subject can hardly avoid it.
const discussionSignals = [
  "blocker", "blocking", "block explicit", "filter", "filtering", "safesearch",
  "parental control", "parental controls", "child safety", "safeguarding",
  "addiction", "addicted", "compulsive", "recovery", "recovering", "relapse",
  "abstinence", "quit", "quitting", "sobriety", "accountability",
  "therapy", "therapist", "counselling", "counseling", "rehab", "support group",
  "research", "researchers", "study", "studies", "survey", "statistics",
  "screen time", "digital wellbeing", "digital wellness", "self-control",
  "harmful", "harms", "prevention", "awareness", "education", "consent",
  "extension", "browser extension", "privacy policy", "open source",
  // Clinical and educational vocabulary. Sexual-health pages were surviving only on the
  // environment gate, which is one signal away from blocking someone's medical reading.
  "health", "doctor", "clinic", "clinical", "medical", "medicine", "nurse",
  "symptom", "symptoms", "diagnosis", "treatment", "contraception", "condom",
  "puberty", "anatomy", "reproductive", "pregnancy", "hormone", "hygiene",
  "curriculum", "students", "teaching", "textbook", "museum", "gallery",
  "art history", "exhibition", "journalism", "reporting", "editorial",
];

const discussionRegexes = discussionSignals.map((phrase) => ({
  phrase,
  regex: new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"),
}));

function countDiscussionSignals(text) {
  let hits = 0;
  for (const { regex } of discussionRegexes) if (regex.test(text)) hits += 1;
  return hits;
}

// Enough commentary vocabulary that the page is describing the subject, not serving it.
// Three rather than two: a hosting page can cheaply sprinkle two of these in a footer,
// and suppression is the one path that turns a block into a pass.
const DISCUSSION_SUPPRESS_AT = 3;

// Keyword scoring counts PRESENCE, not occurrences, so one mention of "porn" in a
// 4,000-word essay scored exactly the same as a tube site's front page. Density is what
// actually separates them.
const MIN_DENSITY_PER_1000 = 12;
// No article discusses the subject this densely. Above it, commentary vocabulary stops
// earning a pass — otherwise a hosting page buys immunity with a word like "filter".
//
// Density alone is not enough to trigger the override, because density is inherently
// high in any SHORT passage: a two-line art-history caption mentioning "nude", "naked"
// and "erotic" reads as denser than a tube site. The override therefore also requires a
// genuinely saturated page, which short commentary never reaches.
const DENSITY_BEYOND_DISCUSSION = 60;
const OCCURRENCES_BEYOND_DISCUSSION = 8;

function keywordOccurrences(text) {
  let total = 0;
  for (const [keyword] of Object.entries(keywordWeights)) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const trailing = /\w$/.test(keyword) ? "\\b" : "";
    const matches = text.match(new RegExp(`\\b${escaped}${trailing}`, "gi"));
    if (matches) total += matches.length;
  }
  return total;
}

function textEvidence(text) {
  const lower = String(text || "").toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean).length;
  const occurrences = keywordOccurrences(lower);
  return {
    score: getKeywordScore(lower),
    words,
    occurrences,
    // Deliberately no minimum word count. A short page that is mostly explicit terms is
    // a hosting page, and an earlier version that zeroed density below 40 words let
    // exactly that through.
    density: words > 0 ? (occurrences / words) * 1000 : 0,
    discussion: countDiscussionSignals(lower),
  };
}

// The gate for a TEXT-ONLY block. Title, URL and image evidence are unaffected — a page
// full of explicit headings or flagged images still blocks regardless of what it says
// about itself.
function textBlocksPage(evidence, profile) {
  if (!evidence || evidence.score < profile.textScore) return false;
  const saturated = evidence.density >= DENSITY_BEYOND_DISCUSSION &&
    evidence.occurrences >= OCCURRENCES_BEYOND_DISCUSSION;
  const commentary = evidence.discussion >= DISCUSSION_SUPPRESS_AT && !saturated;
  if (commentary) return false;
  return evidence.density >= MIN_DENSITY_PER_1000;
}
