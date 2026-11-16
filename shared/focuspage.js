// Focus mode — recognising a streaming page or an endless feed that no list knows about.
//
// shared/focus.js closes the sites it can name. This file is for the rest: it decides from
// what a page is doing, not from what it is called. Pure functions, no DOM and no
// chrome.*: the content script gathers the signals (content.js), and both it and the
// worker run the same decision on them.
//
// Two things are recognised, and both are defined narrowly on purpose, because a wrong
// guess here closes something a person may need for work:
//
//   streaming       a large video player that is long or live, on a page that also shows
//                   it is entertainment: copy protection, a page that declares itself a
//                   film or an episode, or "watch … online / episode 5" wording.
//                   One ordinary video, however long, is not enough. A lecture, a meeting
//                   recording and a normal YouTube video all stay open.
//
//   doom scrolling  what the person is doing, not what the site is: several short
//                   upright videos played one after another, or a page of posts that has
//                   loaded more four times as it was scrolled.

const FOCUS_PAGE = {
  longMinutes: 20,        // a film, an episode, a stream; not a clip
  playerCoverage: 0.25,   // share of the window the player must fill
  shortSeconds: 180,      // the longest a "short" gets
  shortsToTrip: 3,        // one upright clip is a video; three in a row is a feed
  shortsWindowMs: 10 * 60 * 1000,
  feedGrowths: 4,         // times the page loaded more because it was scrolled
  feedScreens: 8,         // window-heights scrolled
  feedPosts: 6,           // posts on the page (feeds that recycle rows keep few)
};

// Open Graph and schema.org types that mean "this is a film or a show".
const FOCUS_OG_ENTERTAINMENT = ["video.movie", "video.episode", "video.tv_show"];
const FOCUS_LD_ENTERTAINMENT = ["movie", "tvepisode", "tvseries", "tvseason", "episode"];

// Wording that streaming pages use about themselves. Deliberately phrases rather than
// single words: "series" alone would catch a lecture on time series, and "Episode 5" alone
// would catch a programming screencast.
const FOCUS_WATCH_WORDS = new RegExp([
  "\\bwatch\\b.{0,60}\\b(online|free|full|hd|episodes?|seasons?|movies?|anime|series)\\b",
  "\\bfull (movie|episode)s?\\b",
  "\\bseason ?\\d{1,3}.{0,12}\\bepisode ?\\d{1,4}\\b",
  "\\bs\\d{1,2} ?e\\d{1,3}\\b",
  "\\b(eng(lish)?|multi) ?(sub|dub)(bed|s)?\\b",
  "\\b(movies?|tv shows?|series|anime) (online|streaming)\\b",
  "\\bstream(ing)? (movies?|tv|shows?|series|anime)\\b",
].join("|"), "i");

function focusWatchWords(text) {
  return FOCUS_WATCH_WORDS.test(String(text || "").slice(0, 600).replace(/[-_/+.]+/g, " "));
}

function focusEntertainmentMeta(signals) {
  const og = String(signals.ogType || "").toLowerCase();
  if (FOCUS_OG_ENTERTAINMENT.includes(og)) return true;
  return (Array.isArray(signals.ldTypes) ? signals.ldTypes : [])
    .some((t) => FOCUS_LD_ENTERTAINMENT.includes(String(t).toLowerCase()));
}

// `signals.player` is the large player on the page, or null:
//   { kind: "video" | "embed", minutes, live, drm }
// "embed" is a large player in a frame from another site, which this script cannot see
// inside. It can only count when the page's own wording says what it is.
function focusStreamingVerdict(signals) {
  const p = signals?.player;
  if (!p) return null;
  const long = Number(p.minutes) >= FOCUS_PAGE.longMinutes;
  const sustained = long || Boolean(p.live);
  const words = focusWatchWords(`${signals.title || ""} ${signals.path || ""}`);

  if (p.kind === "video") {
    if (p.drm && sustained) return { category: "streaming", why: "protected" };
    if (focusEntertainmentMeta(signals) && (sustained || p.drm)) return { category: "streaming", why: "declared" };
    if (words && sustained) return { category: "streaming", why: "wording" };
    return null;
  }
  if (p.kind === "embed" && words) return { category: "streaming", why: "wording" };
  return null;
}

// `signals.shorts` is how many different short upright videos have played in the last
// ten minutes; `signals.feed` is { growths, screens, posts } for the page as scrolled.
function focusFeedVerdict(signals) {
  if (Number(signals?.shorts) >= FOCUS_PAGE.shortsToTrip) {
    return { category: "feeds", why: "shorts" };
  }
  const f = signals?.feed;
  // Scrolling through search results is looking for something, not drifting.
  if (!f || signals.search) return null;
  if (Number(f.growths) >= FOCUS_PAGE.feedGrowths && Number(f.screens) >= FOCUS_PAGE.feedScreens &&
      Number(f.posts) >= FOCUS_PAGE.feedPosts) {
    return { category: "feeds", why: "endless" };
  }
  return null;
}

// `watch` is { streaming, feeds }: which of the two the worker wants looked for on this
// page (shared/focus.js, focusWatchFor). Returns { category, why } or null.
function focusPageVerdict(signals, watch) {
  if (!signals || !watch) return null;
  return (watch.feeds ? focusFeedVerdict(signals) : null) ||
    (watch.streaming ? focusStreamingVerdict(signals) : null);
}
