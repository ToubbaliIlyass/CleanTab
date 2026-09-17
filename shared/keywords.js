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
  // Acts and genre terms with effectively no innocent reading. The list had none of
  // these: a YouTube search for "sexy girls naked" scored 3 against a threshold of 5,
  // because "naked" was not a keyword at all and "sexy" alone could not carry it.
  creampie: 5,
  cumshot: 5,
  deepthroat: 5,
  gangbang: 5,
  handjob: 5,
  titjob: 5,
  rimjob: 5,
  fingering: 5,
  camgirl: 5,
  camgirls: 5,
  milf: 5,
  rule34: 5,
  orgy: 5,
  striptease: 5,

  // Medium confidence (3 points)
  nude: 3,
  sex: 3,
  explicit: 3,
  "18+": 3,
  onlyfans: 3,
  lewd: 3,
  cam: 3,
  cams: 3,
  // Word-boundary anchored, so "nudes" needs its own entry — \bnude\b does not match it.
  nudes: 3,
  naked: 3,
  tits: 3,
  titties: 3,
  boobs: 3,
  pussy: 3,
  cocks: 3,
  anal: 3,
  erotic: 3,
  erotica: 3,
  fetish: 3,
  masturbate: 3,
  masturbating: 3,
  masturbation: 3,
  escort: 3,
  escorts: 3,
  stripper: 3,
  strippers: 3,
  dildo: 3,
  twerk: 3,

  // Low confidence (2 points)
  sexy: 2,
  thirst: 2,
  fuck: 2,
  horny: 2,
  lingerie: 2,
  busty: 2,
  cleavage: 2,
  thong: 2,
  bikini: 2,
  seductive: 2,
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
