const keywordWeights = {
  // High confidence (5 points)
  porn: 5,
  nsfw: 5,
  xxx: 5,
  hentai: 5,
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
  camgirl: 5,
  camgirls: 5,
  milf: 5,
  rule34: 5,
  striptease: 5,

  // Medium confidence (3 points)
  //
  // Words that are explicit in one context and ordinary in another are kept BELOW the
  // blocking threshold on their own: "hardcore" (a gamer, a punk band), "fingering"
  // (piano, guitar), "orgy" ("an orgy of colour"). They still add to a page that has
  // other signals.
  hardcore: 3,
  fingering: 3,
  orgy: 3,
  nude: 3,
  sex: 3,
  explicit: 2,
  "18+": 3,
  onlyfans: 3,
  lewd: 3,
  cam: 2,
  cams: 2,
  // Word-boundary anchored, so "nudes" needs its own entry — \bnude\b does not match it.
  nudes: 3,
  naked: 3,
  tits: 2,
  titties: 3,
  boobs: 3,
  pussy: 2,
  cocks: 2,
  anal: 3,
  erotic: 3,
  erotica: 3,
  fetish: 3,
  masturbate: 3,
  masturbating: 3,
  masturbation: 3,
  escort: 2,
  escorts: 2,
  stripper: 3,
  strippers: 3,
  dildo: 3,
  twerk: 2,

  // Low confidence (2 points)
  sexy: 2,
  thirst: 1,
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

// Low-confidence words (weight under 3) are everyday vocabulary on shopping, fashion and
// lifestyle pages: "sexy dress", "bikini sale". However many of them appear they are
// worth at most this much in total, so a pile of weak words can never add up to a block.
const WEAK_TIER_CAP = 2;

function getKeywordScore(text) {
  let score = 0;
  let weak = 0;
  for (const { regex, weight } of keywordRegexes) {
    if (regex.test(text)) {
      if (weight < 3) weak += weight;
      else score += weight;
    }
  }
  return score + Math.min(weak, WEAK_TIER_CAP);
}

// Exact or subdomain match against the built-in list (m.pornhub.com, not just pornhub.com).
function isKnownAdultDomain(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  if (!host) return false;
  for (const d of knownAdultDomains) {
    if (host === d || host.endsWith("." + d)) return true;
  }
  return false;
}
