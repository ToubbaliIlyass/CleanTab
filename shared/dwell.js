// Pictures you linger on — how evidence adds up to a block.
//
// Nothing here looks at a picture you scroll past. A picture is only classified after it
// has stayed on screen, mostly visible, with the page still, for a couple of seconds
// (content.js). And one picture never stops a page by itself: a single result is a
// swimsuit, a statue, a skin-toned object, or an ad that loaded where you did not ask.
//
// Evidence is counted in points, per page:
//   a flagged picture you lingered on            1 point
//   a near-certain one                           2 points
//   staying on that same picture                 +1 for each further stretch of lingering
//                                                (up to +2 if near-certain, +1 otherwise)
// The page is paused at DWELL_BLOCK_POINTS. So what blocks is a pattern: staying on a
// clearly explicit picture, or stopping on several flagged ones. A borderline picture can
// never reach the bar alone, however long it is looked at. Points fade after two minutes,
// so an article with the occasional beach photo does not creep toward a block.
//
// Pure functions: no DOM, no chrome.*, covered by tests/dwell.test.mjs.

const DWELL_CERTAIN = 0.9;
const DWELL_BLOCK_POINTS = 3;
const DWELL_EVIDENCE_MS = 2 * 60 * 1000;
const DWELL_LINGER_STEP_MS = 4000;

// Points for one classified picture. `score` is predictionUnsafeScore() from the worker.
function dwellPoints(score, profile) {
  if (!(score > 0)) return 0;
  if (score >= DWELL_CERTAIN) return 2;
  return score > profile.unsafeProb ? 1 : 0;
}

function dwellLingerCap(points) {
  return points >= 2 ? 2 : 1;
}

function dwellFresh(evidence, now = Date.now()) {
  return (evidence || []).filter((e) => now - e.ts < DWELL_EVIDENCE_MS);
}

// Record a classified picture. One entry per picture: seeing the same one again (a
// carousel coming round, a re-render) refreshes it rather than counting it twice.
function dwellAdd(evidence, key, points, now = Date.now()) {
  const fresh = dwellFresh(evidence, now);
  if (points <= 0) return fresh;
  const existing = fresh.find((e) => e.key === key);
  if (existing) {
    return fresh.map((e) => (e === existing ? { ...e, points: Math.max(e.points, points), ts: now } : e));
  }
  return [...fresh, { key, points, linger: 0, ts: now }];
}

// The reader is still on a flagged picture one linger step later.
function dwellLinger(evidence, key, now = Date.now()) {
  return dwellFresh(evidence, now).map((e) => (
    e.key === key && e.linger < dwellLingerCap(e.points) ? { ...e, linger: e.linger + 1, ts: now } : e
  ));
}

function dwellCanLinger(evidence, key, now = Date.now()) {
  const e = dwellFresh(evidence, now).find((x) => x.key === key);
  return Boolean(e) && e.linger < dwellLingerCap(e.points);
}

function dwellTotal(evidence, now = Date.now()) {
  return dwellFresh(evidence, now).reduce((sum, e) => sum + e.points + e.linger, 0);
}

function dwellBlocks(evidence, now = Date.now()) {
  return dwellTotal(evidence, now) >= DWELL_BLOCK_POINTS;
}
