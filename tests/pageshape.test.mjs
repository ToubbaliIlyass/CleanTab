// Page shape: which pages get text scanning, and which are aggregated feeds.
//
// This logic lived in content.js and was therefore only testable by hand, which is how
// "every NSFW subreddit is a blind spot" survived. The rule under test is the general
// one: scan the text of every page shape EXCEPT an aggregated home feed.

import { createEnv, makeTester, eq, ok, notOk } from "./harness.mjs";

export default async function () {
  const t = makeTester("page shape");
  const { run } = createEnv();

  const feed = (u) => run(`isHomeFeed(${JSON.stringify(u)})`);
  const listing = (u) => run(`isSubredditListing(${JSON.stringify(u)})`);
  const post = (u) => run(`isInsidePost(${JSON.stringify(u)})`);
  const textScan = (u) => run(`allowsTextScan(${JSON.stringify(u)})`);
  const yt = (u) => run(`isYouTube(${JSON.stringify(u)})`);

  // ── Aggregated feeds: content chosen by a recommender ──────────────────────
  for (const u of [
    "https://www.reddit.com/",
    "https://reddit.com/",
    "https://old.reddit.com/",
    "https://www.reddit.com/r/popular/",
    "https://www.reddit.com/r/all/",
    "https://twitter.com/home",
    "https://x.com/home",
    "https://www.instagram.com/",
  ]) {
    t(`feed: ${u}`, () => ok(feed(u), `${u} should be a home feed`));
    t(`no text scan on ${u}`, () => notOk(textScan(u)));
  }

  // ── Subreddit listings: a chosen destination, NOT a feed ───────────────────
  // The regression. The old isFeedPage() matched /r/<anything>/, which switched off
  // title scoring, while the in-post gate excluded it for not being a post. Nothing but
  // raw URL keywords could fire — and those are word-boundary anchored.
  for (const u of [
    "https://www.reddit.com/r/somesub/",
    "https://www.reddit.com/r/somesub",
    "https://old.reddit.com/r/somesub/",
    "https://www.reddit.com/r/somesub/new/",
    "https://www.reddit.com/r/somesub/top/",
    "https://www.reddit.com/r/a+b/",
  ]) {
    t(`listing: ${u}`, () => ok(listing(u), `${u} should be a listing`));
    t(`not a feed: ${u}`, () => notOk(feed(u), `${u} must not be exempt`));
    t(`text scan runs on ${u}`, () => ok(textScan(u)));
  }

  t("aggregate feeds are not listings", () => {
    notOk(listing("https://www.reddit.com/r/popular/"));
    notOk(listing("https://www.reddit.com/r/all/"));
  });

  t("a bare subreddit name is required", () =>
    notOk(listing("https://www.reddit.com/r/")));

  t("non-reddit hosts are not listings", () =>
    notOk(listing("https://example.com/r/somesub/")));

  // ── The word-boundary case that started this ───────────────────────────────
  // /r/pornrelapsed/ scores 0 on URL keywords (\bporn\b does not match
  // "pornrelapsed"), so URL scoring can never block it. It has to be reachable by text
  // and title scanning instead — recovery communities carry the content they discuss.
  t("pornrelapsed is text-scannable", () =>
    ok(textScan("https://www.reddit.com/r/pornrelapsed/")));
  t("pornrelapsed scores 0 on URL alone", () =>
    eq(run(`getURLScore("https://www.reddit.com/r/pornrelapsed/")`), 0));

  // ── Posts ──────────────────────────────────────────────────────────────────
  for (const u of [
    "https://www.reddit.com/r/somesub/comments/abc123/title/",
    "https://x.com/someone/status/1234567890",
    "https://www.instagram.com/p/Cabc123/",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  ]) {
    t(`post: ${u}`, () => ok(post(u)));
    t(`text scan runs on ${u}`, () => ok(textScan(u)));
  }

  // ── The general rule: every other page shape is scanned ────────────────────
  // Category pages, tag archives, search results and site homepages were all unreachable
  // by text scanning before, on every site on the web.
  for (const u of [
    "https://sometube.example/categories/foo/",
    "https://someblog.example/tag/bar/",
    "https://someforum.example/",
    "https://example.com/gallery?page=3",
    "https://en.wikipedia.org/wiki/Camera",
  ]) {
    t(`text scan runs on ${u}`, () => ok(textScan(u), `${u} should be scannable`));
  }

  t("an unparseable url is still scannable", () => ok(textScan("not a url")));

  // ── YouTube identification is host-based, not substring ────────────────────
  t("youtube.com is youtube", () => ok(yt("https://www.youtube.com/watch?v=x")));
  t("m.youtube.com is youtube", () => ok(yt("https://m.youtube.com/watch?v=x")));
  // The old check was url.includes("youtube.com"), so any site could disable YouTube's
  // text-signal exemption for itself just by putting the string in a path or query.
  t("a path mentioning youtube.com is not youtube", () =>
    notOk(yt("https://example.com/how-to-download-youtube.com-videos")));
  t("a query mentioning youtube.com is not youtube", () =>
    notOk(yt("https://example.com/search?q=youtube.com")));

  return t;
}
