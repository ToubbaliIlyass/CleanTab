const keywordWeights = {
  // High confidence (5 points)
  porn: 5,
  nsfw: 5,
  xxx: 5,
  hentai: 5,
  hardcore: 5,
  bdsm: 5,
  blowjob: 5,
  pornhub: 5,
  xvideos: 5,
  redtube: 5,
  youporn: 5,

  // Medium confidence (3 points)
  nude: 3,
  sex: 3,
  explicit: 3,
  "18+": 3,
  onlyfans: 3,
  lewd: 3,
  cam: 3,
  cams: 3,

  // Low confidence (2 points)
  sexy: 2,
  thirst: 2,
  fuck: 2,
};

const knownAdultDomains = new Set([
  "pornhub.com",
  "xvideos.com",
  "redtube.com",
  "youporn.com",
  "xhamster.com",
  "tube8.com",
  "spankbang.com",
  "eporner.com",
  "chaturbate.com",
  "cam4.com",
  "myfreecams.com",
  "onlyfans.com",
  "fansly.com",
]);

function buildKeywordRegex(keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const trailingBoundary = /\w$/.test(keyword) ? "\\b" : "";
  return new RegExp(`\\b${escaped}${trailingBoundary}`, "i");
}

const keywordRegexes = Object.entries(keywordWeights).map(([keyword, weight]) => ({
  regex: buildKeywordRegex(keyword),
  weight,
}));

function getKeywordScore(text) {
  let score = 0;
  for (const { regex, weight } of keywordRegexes) {
    if (regex.test(text)) {
      score += weight;
    }
  }
  return score;
}
