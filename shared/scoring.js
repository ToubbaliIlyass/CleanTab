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
