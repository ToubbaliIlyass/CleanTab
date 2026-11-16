///////////////////////////////
// CleanTab — content script
// Context-aware, SPA-safe, scoring-based detection.
//
// Keyword lists (shared/keywords.js), thresholds (shared/thresholds.js) and URL scoring
// (shared/scoring.js) are loaded ahead of this file by the manifest. They used to be
// copy-pasted here and in background.js, and the copies had already drifted apart.
///////////////////////////////

// Set so the worker can tell an already-injected tab from one that needs injecting
// (injectIntoOpenTabs in background.js) without redeclaring everything below.
globalThis.__cleantabLoaded = true;

// ── Policy ────────────────────────────────────────────────────────────────────
//
// The content script owns no rules. It asks the service worker what applies to this URL
// and caches the answer. That is what lets sensitivity, per-site pause and one-time
// allowances take effect without every page touching storage directly.

let policy = {
  enabled: true,
  trusted: false,
  sitePausedUntil: null,
  allowed: false,
  profile: getProfile("balanced"),
  dwellEnabled: false,
  userBlocked: false,
  knownAdult: false,
};

let policyReady = false;

function refreshPolicy() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "getTabPolicy", url: location.href }, (res) => {
      if (!chrome.runtime.lastError && res && !res.error) {
        policy = res;
        policy.profile = res.profile || getProfile("balanced");
      }
      policyReady = true;
      resolve(policy);
    });
  });
}

function scanningSuppressed() {
  if (!policy.enabled) return true;
  if (policy.trusted) return true;
  if (policy.allowed) return true;
  if (policy.sitePausedUntil && policy.sitePausedUntil > Date.now()) return true;
  return false;
}

// ── Lists, checked before the page has loaded ────────────────────────────────
//
// The built-in adult-site list and the user's own blocklist need no page content, so they
// are acted on at document_start instead of waiting for the load event. The user's list
// and the built-in list both beat the trust list, skipping the site, and a one-time pass:
// a list is a decision made in advance, and nothing done in the moment overrides it. Only
// the global off switch (which has its own cost) does.

function listBlockReason() {
  if (!policy.enabled) return null;
  if (policy.userBlocked) return "You blocked this site";
  if (policy.knownAdult) return "This site is on the adult-site list";
  return null;
}

// ── Focus mode ────────────────────────────────────────────────────────────────
//
// The worker says whether this URL is off-limits while focusing (shared/focus.js) and
// when to ask again. Independent of protection: it applies with protection off, and to
// trusted sites. Nothing is reported as a verdict, because a focus block is not a slip.

function focusBlocked() {
  return Boolean(policy.focus && policy.focus.blocked);
}

function enforceFocus() {
  if (!focusBlocked() || redirectTriggered) return false;
  triggerRedirect(policy.focus.reason, "focus");
  return true;
}

// A schedule starting, or a five-minute pass running out, changes the answer without any
// storage write to announce it. The policy carries the time; this re-asks once it passes.
let focusRecheckAt = 0;
function maybeRecheckFocus() {
  const at = policy.focus && policy.focus.nextChange;
  if (!at || Date.now() < at || Date.now() < focusRecheckAt) return;
  focusRecheckAt = Date.now() + 15000; // never more than one question every 15 s
  refreshPolicy().then(enforceFocus).catch(() => {});
}

// ── Focus mode: pages no list names ───────────────────────────────────────────
//
// While focus is on and the worker has no rule for this URL, the page is watched for the
// two things focus closes: a streaming player, and doom scrolling. What counts as either
// is decided in shared/focuspage.js; this only measures. It runs once a second from the
// navigation tick, only during focus, only in the top frame, and reads nothing but
// sizes, durations and the page's own description of itself. Nothing leaves the device.

const focusSeen = {
  drm: false,           // a video on this page asked for a decryption key
  shorts: new Map(),    // short upright videos played: source → when
  path: "",             // endless-scroll counters belong to one address
  scrolled: false,
  lastHeight: 0,
  growths: 0,
  screens: 0,
  meta: null,           // { url, ogType, ldTypes }
  askedAt: 0,
};

// `encrypted` does not bubble, so it is caught on the way down.
document.addEventListener("encrypted", () => { focusSeen.drm = true; }, true);
window.addEventListener("scroll", () => { focusSeen.scrolled = true; }, { passive: true, capture: true });

function visibleBox(el) {
  const r = el.getBoundingClientRect();
  const w = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0);
  const h = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
  return w > 0 && h > 0 ? { w, h, area: w * h } : { w: 0, h: 0, area: 0 };
}

// A camera or a call is a video too, and never the kind focus is about.
function isCallVideo(v) {
  try { return typeof MediaStream !== "undefined" && v.srcObject instanceof MediaStream; } catch { return false; }
}

function pageMeta() {
  if (focusSeen.meta && focusSeen.meta.url === location.href) return focusSeen.meta;
  const ldTypes = [];
  const collect = (node, depth) => {
    if (!node || depth > 4 || ldTypes.length > 40) return;
    if (Array.isArray(node)) { node.forEach((n) => collect(n, depth + 1)); return; }
    if (typeof node !== "object") return;
    [].concat(node["@type"] || []).forEach((t) => { if (typeof t === "string") ldTypes.push(t); });
    collect(node["@graph"], depth + 1);
  };
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length && i < 6; i++) {
    const text = scripts[i].textContent || "";
    if (text.length > 100000) continue;
    try { collect(JSON.parse(text), 0); } catch { /* not ours to fix */ }
  }
  focusSeen.meta = {
    url: location.href,
    ogType: document.querySelector('meta[property="og:type"]')?.content || "",
    ldTypes,
  };
  return focusSeen.meta;
}

function gatherFocusSignals(watch) {
  const now = Date.now();
  const viewport = window.innerWidth * window.innerHeight || 1;
  let player = null;
  let playerArea = 0;

  for (const v of document.querySelectorAll("video")) {
    if (isCallVideo(v)) continue;
    const playing = !v.paused && !v.ended && v.currentTime > 2;
    if (!playing) continue;
    const box = visibleBox(v);
    const duration = v.duration;

    // A short: upright, brief, and filling at least half the window's height.
    if (watch.feeds && Number.isFinite(duration) && duration <= FOCUS_PAGE.shortSeconds &&
        v.videoHeight >= v.videoWidth * 1.2 && box.h >= window.innerHeight * 0.5) {
      const key = v.currentSrc || v.src || `#${duration}`;
      if (!focusSeen.shorts.has(key)) focusSeen.shorts.set(key, now);
    }

    if (watch.streaming && box.area >= viewport * FOCUS_PAGE.playerCoverage && box.area > playerArea) {
      playerArea = box.area;
      player = {
        kind: "video",
        minutes: Number.isFinite(duration) ? duration / 60 : null,
        live: duration === Infinity,
        drm: focusSeen.drm || Boolean(v.mediaKeys),
      };
    }
  }

  // A player in a frame from another site cannot be seen into. Its size is all there is.
  if (watch.streaming && !player) {
    for (const f of document.querySelectorAll('iframe[allowfullscreen], iframe[allow*="fullscreen"]')) {
      if (visibleBox(f).area >= viewport * FOCUS_PAGE.playerCoverage) {
        player = { kind: "embed", minutes: null, live: false, drm: false };
        break;
      }
    }
  }

  for (const [key, at] of focusSeen.shorts) {
    if (now - at > FOCUS_PAGE.shortsWindowMs) focusSeen.shorts.delete(key);
  }

  // Endless scroll: the page got at least a window taller after being scrolled.
  const feed = { growths: 0, screens: 0, posts: 0 };
  const scroller = document.scrollingElement;
  if (watch.feeds && scroller) {
    if (focusSeen.path !== location.pathname) {
      focusSeen.path = location.pathname;
      focusSeen.lastHeight = 0;
      focusSeen.growths = 0;
      focusSeen.screens = 0;
    }
    const vh = window.innerHeight || 1;
    const height = scroller.scrollHeight;
    if (!focusSeen.lastHeight) {
      focusSeen.lastHeight = height;
    } else if (height >= focusSeen.lastHeight + vh * 0.8) {
      if (focusSeen.scrolled) focusSeen.growths += 1;
      focusSeen.lastHeight = height;
      focusSeen.scrolled = false;
    }
    focusSeen.screens = Math.max(focusSeen.screens, scroller.scrollTop / vh);
    feed.growths = focusSeen.growths;
    feed.screens = Math.round(focusSeen.screens * 10) / 10;
    if (feed.growths >= FOCUS_PAGE.feedGrowths && feed.screens >= FOCUS_PAGE.feedScreens) {
      feed.posts = document.querySelectorAll('article, [role="article"], [role="feed"] > *').length;
    }
  }

  const meta = player ? pageMeta() : { ogType: "", ldTypes: [] };
  return {
    title: document.title.slice(0, 300),
    path: location.pathname.slice(0, 300),
    ogType: meta.ogType,
    ldTypes: meta.ldTypes,
    player,
    shorts: focusSeen.shorts.size,
    feed,
    search: /[?&](q|query|search|search_query|keyword|k|s)=/i.test(location.search) ||
      /\/search(\/|$)/i.test(location.pathname),
  };
}

function watchFocusPage() {
  const focus = policy.focus;
  if (!focus || !focus.active || focus.blocked || !focus.watch) return;
  if (redirectTriggered || window.top !== window) return;
  let signals;
  try { signals = gatherFocusSignals(focus.watch); } catch { return; }
  if (!focusPageVerdict(signals, focus.watch)) return;
  if (Date.now() - focusSeen.askedAt < 5000) return; // the worker said no a moment ago
  focusSeen.askedAt = Date.now();
  try {
    chrome.runtime.sendMessage({ action: "focusDetected", signals }, (res) => {
      void chrome.runtime.lastError;
      if (res && res.ok) redirectTriggered = true;
    });
  } catch {
    // Extension reloaded under this page.
  }
}

// Page shape helpers (isInsidePost, isYouTube, isHomeFeed, allowsTextScan) come from
// shared/pageshape.js, loaded ahead of this file by the manifest.

// ── Scoring ───────────────────────────────────────────────────────────────────
//
// The decision itself lives in shared/detect.js (pure, covered by tests/corpus.test.mjs).
// This only gathers what is visibly on the page.

const ENV_MAX_ELEMENTS = 2500;

// Navigation, footers, sidebars, comment threads and code are boilerplate or other
// people's words, not what the page is about.
const BOILERPLATE = "nav, footer, aside, header nav, [role=navigation], [role=complementary], " +
  "[role=contentinfo], code, pre, script, style, noscript, template, [aria-hidden=true], " +
  "[hidden], #comments, .comments, [class*=comment], [id*=comment], [class*=cookie], " +
  "[class*=consent], [class*=sidebar]";

function collectTexts(selector, limit, field) {
  const out = [];
  const nodes = document.querySelectorAll(selector);
  for (let i = 0; i < nodes.length && out.length < limit; i++) {
    const node = nodes[i];
    if (node.closest(BOILERPLATE)) continue;
    // textContent: innerText forces layout per element.
    const text = node.textContent;
    if (text && text.length <= 300) out.push(text);
  }
  return out;
}

function gatherPage() {
  return {
    url: window.location.href,
    bodyText: document.body?.innerText || "",
    titleTexts: [
      document.title,
      ...collectTexts('h1, h2, h3, [class*="title"], [class*="headline"], a[href*="/"], figcaption', 50),
    ],
    envTexts: collectTexts("h1, h2, h3, a, button, span, label", ENV_MAX_ELEMENTS),
  };
}

// ── Scan ──────────────────────────────────────────────────────────────────────

let redirectTriggered = false;

function resetRedirectProtection() {
  redirectTriggered = false;
}

function triggerRedirect(reason, kind) {
  redirectTriggered = true;
  try {
    chrome.runtime.sendMessage({ action: "redirect", reason, kind }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // Extension reloaded under this page; nothing left to talk to.
  }
  setTimeout(resetRedirectProtection, 1500);
}

function reportVerdict(clean, score) {
  chrome.runtime.sendMessage({ action: "tabVerdict", clean, score }, () => {
    void chrome.runtime.lastError; // tab may have navigated away
  });
}

function scan() {
  try {
    if (!policyReady || redirectTriggered) return;

    const profile = policy.profile;

    if (enforceFocus()) return;

    const listReason = listBlockReason();
    if (listReason) {
      reportVerdict(false, 5);
      triggerRedirect(listReason);
      return;
    }

    if (scanningSuppressed()) {
      // A trusted site still counts as browsing; a one-time allowance does not count as
      // clean, because the page was flagged and the user chose to pass anyway.
      if (policy.enabled) reportVerdict(!policy.allowed, 0);
      return;
    }

    const url = window.location.href;
    lastScanSize = document.body?.textContent?.length || 0;

    const page = gatherPage();
    const decision = decidePage(page, profile);
    const { scores, evidence } = decision;
    if (decision.block) {
      reportVerdict(false, 5);
      triggerRedirect(decision.reason);
      return;
    }

    // Nothing fired. Before settling, ask whether this is a page the rules are merely
    // unsure about — a near miss, or a block they talked themselves out of. Only those
    // are worth a model, and the answer arrives asynchronously so the page is never
    // held up waiting for it.
    maybeAdjudicate({ url, scores, evidence, profile, wouldBlock: false });

    reportVerdict(true, riskLevel(scores, profile));
  } catch (error) {
    console.error("CleanTab scan error:", error);
    // Never let a detection failure break the page.
  }
}

// ── Second opinion ────────────────────────────────────────────────────────────
//
// The rules decide; this only runs where they are genuinely unsure. It can add a block
// they missed — which is the whole non-English and euphemism case, since those pages
// score zero on an English keyword list — and it can clear one they were already
// hesitant about. It can never clear a page that blocked on strong evidence, because
// such a page is never sent (adjudicationAllowed in shared/nano.js).

let adjudicating = false;

function maybeAdjudicate(context) {
  if (adjudicating || redirectTriggered || scanningSuppressed()) return;

  const enriched = {
    scores: context.scores,
    profile: context.profile,
    evidence: context.evidence,
    wouldBlock: context.wouldBlock,
    commentary: isCommentary(context.evidence),
    saturated: Boolean(context.evidence && context.evidence.density >= 60 &&
      context.evidence.occurrences >= 8),
    knownAdultDomain: false, // the worker knows the blocklist; it re-checks there
  };
  if (!adjudicationAllowed(enriched)) return;

  adjudicating = true;
  chrome.runtime.sendMessage({
    action: "nanoAdjudicate",
    context: enriched,
    page: {
      url: context.url,
      title: document.title || "",
      text: (document.body?.innerText || "").slice(0, 4000),
    },
  }, (res) => {
    adjudicating = false;
    if (chrome.runtime.lastError || !res?.verdict) return;
    if (redirectTriggered || scanningSuppressed()) return;

    const decision = applyAdjudication(
      { blocked: context.wouldBlock, reason: "" },
      res.verdict,
    );
    if (decision.blocked && !context.wouldBlock) {
      reportVerdict(false, 5);
      triggerRedirect(decision.reason);
    }
  });
}

let scanTimeout;
function debouncedScan(delay = 300) {
  clearTimeout(scanTimeout);
  scanTimeout = setTimeout(scan, delay);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let initStarted = false;

async function init() {
  if (initStarted) return; // the load listener and the readyState fallback can both fire
  initStarted = true;
  await (earlyPolicy || refreshPolicy());
  earlyPolicy = null;
  scan();
  maybeStartDwell();
}

// Image scanning can be switched on after the page loaded, so this is also called when the
// policy is re-read. The observer is only ever started once per page.
let dwellStarted = false;
function maybeStartDwell() {
  if (dwellStarted || !policy.dwellEnabled || !document.body) return;
  dwellStarted = true;
  startDwellObserver();
}

// document_idle frequently runs AFTER the load event has already fired, in which case a
// bare load listener never runs and the page is never scanned at all. Cover both.
//
// The script now runs at document_start, so readyState is usually "loading" here. The
// policy is fetched immediately and the lists acted on without waiting for the DOM.
let earlyPolicy = refreshPolicy().then((p) => {
  if (enforceFocus()) return p;
  const reason = listBlockReason();
  if (reason && !redirectTriggered) {
    reportVerdict(false, 5);
    triggerRedirect(reason);
  }
  return p;
});

if (document.readyState === "complete") {
  init();
} else {
  window.addEventListener("load", init, { once: true });
  // Fallback for pages whose load event never settles (long-polling, stalled subresources).
  if (document.readyState !== "loading") setTimeout(init, 1500);
  else document.addEventListener("DOMContentLoaded", () => setTimeout(init, 1500), { once: true });
}

// SPA navigation (YouTube, Twitter, Reddit…)
let lastUrl = location.href;

async function handleNavigation() {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  redirectTriggered = false;
  rescans = 0;
  lastScanSize = 0;
  dwellEvidence = [];
  stopLingerWatch();
  try {
    await refreshPolicy(); // allowances and pauses are URL-scoped
  } catch {
    return; // extension context invalidated
  }
  maybeStartDwell();
  debouncedScan(500);
}

// Content scripts cannot hook history.pushState from their isolated world, so SPA
// navigation is polled. Hidden tabs skip the poll (visibilitychange catches up), and the
// timer stops for good once the extension has been reloaded or updated underneath us,
// when every chrome.runtime call would throw once a second.
// The same tick re-scans a page that has grown a lot since it was scanned (infinite
// scroll, late-loading sections), which used to be a blind spot. Throttled and capped:
// textContent length is cheap, and a rescan is one body.innerText read.
let lastScanSize = 0;
let rescans = 0;
let lastRescanAt = 0;
function maybeRescan() {
  if (!policyReady || redirectTriggered || scanningSuppressed() || rescans >= MAX_RESCANS) return;
  if (Date.now() - lastRescanAt < RESCAN_MIN_MS) return;
  const size = document.body?.textContent?.length || 0;
  if (lastScanSize && size > lastScanSize * 1.5 + 2000) {
    rescans += 1;
    lastRescanAt = Date.now();
    scan();
  }
}
const MAX_RESCANS = 5;
const RESCAN_MIN_MS = 5000;

const navTimer = setInterval(() => {
  if (!chrome.runtime?.id) { clearInterval(navTimer); return; }
  if (document.hidden) return;
  handleNavigation();
  maybeRescan();
  maybeRecheckFocus();
  watchFocusPage();
}, 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && chrome.runtime?.id) { handleNavigation(); maybeRecheckFocus(); }
});
window.addEventListener("popstate", () => setTimeout(handleNavigation, 300));

// Re-read policy when settings change so sensitivity and trust take effect without a
// reload. Content scripts can read storage.local directly; the policy itself still comes
// from the worker so the session-scoped parts stay in one place.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.enabled || changes.trustedSites || changes.sensitivity ||
      changes.disableUntil || changes.enableDwellDetection || changes.blockedSites ||
      changes.focus || changes.focusSession || changes.focusSkipUntil) {
    refreshPolicy().then(() => { maybeStartDwell(); debouncedScan(100); });
  }
});

// ── Cross-origin image encode fallback (plan §8.4.3) ───────────────────────────
//
// Some CDNs reject the worker's credential-less fetch. The page already has the bytes,
// so it re-encodes them through a canvas. Only works for images the page loaded with
// CORS access; tainted canvases throw and we report failure honestly rather than "safe".

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.action !== "encodeImage") return false;
  try {
    const img = [...document.images].find((i) => i.src === msg.src || i.currentSrc === msg.src);
    if (!img || !img.complete || !img.naturalWidth) { sendResponse({ dataUrl: null }); return true; }
    // The classifier resizes to 224px anyway; a downscale keeps a 20-megapixel photo from
    // becoming a multi-megabyte message.
    const scale = Math.min(1, 640 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    sendResponse({ dataUrl: canvas.toDataURL("image/jpeg", 0.8) });
  } catch {
    sendResponse({ dataUrl: null }); // tainted canvas
  }
  return true;
});

// ── Dwell-based image detection ───────────────────────────────────────────────

// Image-first platforms. This used to be an allowlist that decided *whether* dwell
// scanning ran at all, which meant an explicit image on any other site — a forum, a
// blog, an imageboard, a tube-site clone — was never looked at. It now only decides how
// large an image has to be before it is worth classifying: on a feed, a 180px thumbnail
// is the content; on an ordinary page, images that size are usually chrome and avatars.
const VISUAL_PLATFORMS = new Set([
  "pinterest.com", "reddit.com", "twitter.com", "x.com",
  "instagram.com", "tumblr.com", "imgur.com", "deviantart.com",
  "flickr.com", "4chan.org", "9gag.com",
]);

const DWELL_MS = 2000;
const MIN_IMAGE_PX = 180;
const MIN_IMAGE_PX_GENERAL = 260;
const CLASSIFY_RATE_MS = 2000;
const OBSERVE_DEBOUNCE_MS = 400;

let isPageScrolling = false;
let scrollStopTimeout;
window.addEventListener("scroll", () => {
  isPageScrolling = true;
  clearTimeout(scrollStopTimeout);
  scrollStopTimeout = setTimeout(() => { isPageScrolling = false; }, 250);
}, { passive: true });

// How the results add up is in shared/dwell.js: points per page, fading after two
// minutes, and never a block from one picture alone.
let dwellEvidence = [];
// Pictures currently on screen (set by the observer below), so "still looking at it" can
// be told from "scrolled on".
const dwellOnScreen = new WeakSet();

let dwellClassifyInFlight = false;
let dwellClassifyQueued = null;
let dwellLastClassifyTime = 0;

function dwellMaybeBlock() {
  if (!dwellBlocks(dwellEvidence) || scanningSuppressed() || redirectTriggered) return false;
  stopLingerWatch();
  reportVerdict(false, 5);
  triggerRedirect("You lingered on pictures that were flagged");
  return true;
}

// After a picture is flagged: while the reader stays on it, the evidence grows a step at
// a time. Scrolling away, switching tabs or the picture leaving the screen ends it.
let lingerTimer = null;
function stopLingerWatch() {
  if (lingerTimer) clearInterval(lingerTimer);
  lingerTimer = null;
}
function watchLinger(img, key) {
  stopLingerWatch();
  lingerTimer = setInterval(() => {
    if (!chrome.runtime?.id || !img.isConnected || !dwellOnScreen.has(img) ||
        !dwellCanLinger(dwellEvidence, key) || scanningSuppressed()) {
      stopLingerWatch();
      return;
    }
    if (document.hidden || isPageScrolling) return; // not looking right now; ask again
    dwellEvidence = dwellLinger(dwellEvidence, key);
    dwellMaybeBlock();
  }, DWELL_LINGER_STEP_MS);
}

function dispatchImageClassification(src, img) {
  dwellClassifyInFlight = true;
  dwellLastClassifyTime = Date.now();

  chrome.runtime.sendMessage({ action: "classifyImage", src }, (response) => {
    dwellClassifyInFlight = false;
    if (chrome.runtime.lastError) return;
    const points = dwellPoints(response?.score || 0, policy.profile);
    if (points > 0) {
      dwellEvidence = dwellAdd(dwellEvidence, src, points);
      if (!dwellMaybeBlock() && img && dwellOnScreen.has(img)) watchLinger(img, src);
    }
    if (dwellClassifyQueued) {
      const next = dwellClassifyQueued;
      dwellClassifyQueued = null;
      const delay = Math.max(0, CLASSIFY_RATE_MS - (Date.now() - dwellLastClassifyTime));
      setTimeout(() => dispatchImageClassification(next.src, next.img), delay);
    }
  });
}

function requestImageClassification(src, img) {
  if (!src || src.startsWith("data:") || src.startsWith("blob:")) return;
  const now = Date.now();
  if (dwellClassifyInFlight || (now - dwellLastClassifyTime) < CLASSIFY_RATE_MS) {
    dwellClassifyQueued = { src, img };
    return;
  }
  dispatchImageClassification(src, img);
}

function startDwellObserver() {
  // Runs on every site. The cost controls are the dwell delay, the size floor and the
  // rate limit — not an allowlist of hostnames.
  const minImagePx = VISUAL_PLATFORMS.has(normalizeDomain(location.hostname))
    ? MIN_IMAGE_PX
    : MIN_IMAGE_PX_GENERAL;

  const dwellTimers = new WeakMap();
  const clearedImages = new WeakSet();

  const intersectionObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const img = entry.target;
      if (entry.isIntersecting) dwellOnScreen.add(img);
      else dwellOnScreen.delete(img);
      if (clearedImages.has(img)) return;

      if (entry.isIntersecting) {
        const tid = setTimeout(() => {
          const src = img.currentSrc || img.src;
          // Still there, page still, tab in front: that is lingering. Anything else is
          // a picture that went by.
          if (policy.dwellEnabled && !isPageScrolling && !document.hidden && !redirectTriggered &&
              !scanningSuppressed() && src) {
            clearedImages.add(img);
            requestImageClassification(src, img);
          }
        }, DWELL_MS);
        dwellTimers.set(img, tid);
      } else {
        const tid = dwellTimers.get(img);
        if (tid) { clearTimeout(tid); dwellTimers.delete(img); }
      }
    });
  }, { threshold: 0.5 });

  const observed = new WeakSet();

  function observeImage(img) {
    if (observed.has(img) || clearedImages.has(img)) return;
    const check = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (w >= minImagePx || h >= minImagePx) {
        observed.add(img);
        intersectionObserver.observe(img);
      }
    };
    if (img.complete) check();
    else img.addEventListener("load", check, { once: true });
  }

  document.querySelectorAll("img").forEach(observeImage);

  // The previous version re-ran querySelectorAll("img") over the whole document on every
  // mutation. On an infinite feed that was the dominant cost of the whole extension.
  // Only new subtrees are inspected now, and bursts are coalesced.
  let pending = [];
  let flushTimer = null;

  function flush() {
    flushTimer = null;
    const nodes = pending;
    pending = [];
    for (const node of nodes) {
      if (node.nodeType !== 1) continue;
      if (node.tagName === "IMG") observeImage(node);
      else node.querySelectorAll?.("img").forEach(observeImage);
    }
  }

  const mutationObserver = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) pending.push(node);
    }
    if (pending.length && !flushTimer) flushTimer = setTimeout(flush, OBSERVE_DEBOUNCE_MS);
  });

  mutationObserver.observe(document.body, { childList: true, subtree: true });
}
