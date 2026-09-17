// What kind of page is this? Lives here rather than in content.js so the test suite can
// reach it — this is the logic that made every NSFW subreddit a blind spot, and it is not
// the kind of thing that should only be verifiable by hand.
//
// Three shapes matter, because each one deserves a different amount of suspicion:
//
//   home feed   — aggregated content you did not choose. Titles here belong to strangers'
//                 posts, so title scoring misfires constantly. Text scanning stays off.
//   listing     — a destination you navigated to on purpose: a specific subreddit. The
//                 content is the point, so it gets the full text + title treatment.
//   inside post — a single item. Always scanned.
//
// The old isFeedPage() collapsed the first two: `reddit.com/r/<anything>/` counted as a
// feed, which disabled title scoring (rule 2) while the in-post gate (rule 3) excluded it
// for not being a post. Nothing but raw URL keywords could fire on a subreddit listing —
// and keyword matching is word-boundary anchored, so `/r/pornrelapsed/` scored zero.

const REDDIT_HOSTS = new Set(["reddit.com", "old.reddit.com", "new.reddit.com", "np.reddit.com"]);

// Reddit's own aggregate feeds. Content here is chosen by Reddit, not by the user.
const REDDIT_AGGREGATE_FEEDS = new Set(["popular", "all", "home"]);

// Listing sort suffixes: /r/name/, /r/name/new/, /r/name/top/?t=week …
const REDDIT_SORTS = new Set(["", "new", "hot", "top", "rising", "controversial", "best"]);

function parseLocation(url) {
  try {
    const parsed = new URL(url);
    return {
      host: normalizeDomain(parsed.hostname),
      // Trailing slash stripped so /r/x and /r/x/ take the same path through here.
      segments: parsed.pathname.toLowerCase().split("/").filter(Boolean),
      pathname: parsed.pathname.toLowerCase(),
    };
  } catch {
    return null;
  }
}

function isYouTube(url) {
  const loc = parseLocation(url);
  return loc ? loc.host === "youtube.com" || loc.host.endsWith(".youtube.com") : false;
}

function isInsidePost(url) {
  const lower = String(url).toLowerCase();
  const postPatterns = [
    /\/comments\/\w+/,    // Reddit posts
    /\/status\/\d+/,      // Twitter posts
    /\/p\/[\w-]+/,        // Instagram posts
    /watch\?v=[\w-]+/,    // YouTube videos
    /\/post\/[\w-]+/,     // Generic posts
    /\/posts\/\d+/,       // Forum posts
    /article\/[\w-]+/,    // News articles
  ];
  return postPatterns.some((pattern) => pattern.test(lower));
}

// A subreddit listing: /r/<name>/ with an optional sort suffix. Multireddits (/r/a+b/)
// count — they are still a deliberate destination.
function isSubredditListing(url) {
  const loc = parseLocation(url);
  if (!loc || !REDDIT_HOSTS.has(loc.host)) return false;
  if (loc.segments[0] !== "r" || !loc.segments[1]) return false;
  if (REDDIT_AGGREGATE_FEEDS.has(loc.segments[1])) return false; // /r/popular is a feed
  if (loc.segments.length === 2) return true;
  return loc.segments.length === 3 && REDDIT_SORTS.has(loc.segments[2]);
}

// Aggregated feeds only. Deliberately narrow: everything not listed here is scored.
function isHomeFeed(url) {
  const loc = parseLocation(url);
  if (!loc) return false;

  if (REDDIT_HOSTS.has(loc.host)) {
    if (loc.segments.length === 0) return true;                        // reddit.com/
    if (loc.segments[0] === "r" && REDDIT_AGGREGATE_FEEDS.has(loc.segments[1])) return true;
    return false;
  }
  if (loc.host === "twitter.com" || loc.host === "x.com") {
    return loc.segments[0] === "home" || loc.segments.length === 0;
  }
  if (loc.host === "instagram.com") return loc.segments.length === 0;

  return false;
}

// Rule 3 (adult environment + explicit content) used to require being inside a post,
// which is why it never fired on a subreddit listing, a category page, a tag archive or
// a site's own homepage. The general rule is the inverse: scan the text of every page
// shape except an aggregated home feed, where the words on screen were chosen by a
// recommender rather than by the person reading them.
//
// This is still gated on the environment score in content.js, so an ordinary page that
// merely mentions a keyword does not trip it.
function allowsTextScan(url) {
  return !isHomeFeed(url);
}
