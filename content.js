///////////////////////////////
// CleanTab — content script
// Context-aware, SPA-safe, scoring-based detection.
//
// Keyword lists (shared/keywords.js), thresholds (shared/thresholds.js) and URL scoring
// (shared/scoring.js) are loaded ahead of this file by the manifest. They used to be
// copy-pasted here and in background.js, and the copies had already drifted apart.
///////////////////////////////

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

// ── Environment keyword clusters ──────────────────────────────────────────────

// Matched with word boundaries by getEnvironmentScore (see adultAnchorRegexes below).
// They used to be plain substring tests, which qualified every camera retailer as an
// adult environment because "cam" appears in "cameras" — and left the environment gate,
// the first line of defence for rules 2 and 3, firing on ordinary shopping pages.
const adultAnchorWords = [
  "porn", "nsfw", "xxx", "cam", "cams", "hentai", "blowjob", "bdsm", "nude",
  "naked", "nudes", "milf", "onlyfans", "camgirl", "creampie", "gangbang",
];

const adultContextWords = [
  "model", "models", "private", "room", "girls", "chat", "show", "studio",
];

const mediaWords = ["video", "videos", "live", "stream", "watch"];

function boundaryRegex(word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i");
}

const adultAnchorRegexes = adultAnchorWords.map(boundaryRegex);
const adultContextRegexes = adultContextWords.map(boundaryRegex);
const mediaRegexes = mediaWords.map(boundaryRegex);

// Page shape helpers (isInsidePost, isYouTube, isHomeFeed, allowsTextScan) come from
// shared/pageshape.js, loaded ahead of this file by the manifest.

// ── Scoring ───────────────────────────────────────────────────────────────────

function getExplicitTitleScore() {
  let score = 0;
  const elements = document.querySelectorAll(
    'h1, h2, h3, title, [class*="title"], [class*="headline"], a[href*="/"], figcaption',
  );
  const maxElements = Math.min(elements.length, 50);

  for (let i = 0; i < maxElements; i++) {
    const text = (elements[i].innerText || elements[i].textContent || "").toLowerCase();
    if (!text || text.length > 200) continue;
    score += getKeywordScore(text) * 1.5;
    if (score >= 15) break;
  }
  return score;
}

function getEnvironmentScore() {
  let anchorCount = 0;
  let score = 0;

  const elements = document.querySelectorAll("h1, h2, h3, a, button, span, label");

  elements.forEach((el) => {
    const text = (el.innerText || "").toLowerCase();
    if (!text) return;

    adultAnchorRegexes.forEach((r) => {
      if (r.test(text)) { anchorCount += 1; score += 3; }
    });

    // Context and media words amplify, but only once an adult anchor exists —
    // otherwise "live stream" and "private room" light up on ordinary sites.
    if (anchorCount > 0) {
      adultContextRegexes.forEach((r) => { if (r.test(text)) score += 1; });
      mediaRegexes.forEach((r) => { if (r.test(text)) score += 1; });
    }
  });

  return anchorCount >= 1 ? score : 0;
}

// ── Scan ──────────────────────────────────────────────────────────────────────

let redirectTriggered = false;

function resetRedirectProtection() {
  redirectTriggered = false;
}

function triggerRedirect(reason) {
  redirectTriggered = true;
  chrome.runtime.sendMessage({ action: "redirect", reason });
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

    if (scanningSuppressed()) {
      // A trusted site still counts as browsing; a one-time allowance does not count as
      // clean, because the page was flagged and the user chose to pass anyway.
      if (policy.enabled) reportVerdict(!policy.allowed, 0);
      return;
    }

    const url = window.location.href;
    const onYouTube = isYouTube(url);
    // Text scanning applies to every page shape except an aggregated home feed. It used
    // to require being inside a post, which left every listing, category, tag and
    // homepage on the web reachable only by URL keywords.
    const textScannable = allowsTextScan(url);

    const evidence = onYouTube ? null : textEvidence(document.body?.innerText || "");
    const scores = {
      url: getURLScore(url),
      text: evidence ? evidence.score : 0,
      title: getExplicitTitleScore(),
    };
    const environmentScore = getEnvironmentScore();
    const riskyEnvironment = environmentScore >= profile.envScore;

    // 1. Strong URL intent — global, applies everywhere including YouTube.
    if (scores.url >= profile.urlScore) {
      reportVerdict(false, 5);
      triggerRedirect("Search or link contained high-risk keywords");
      return;
    }

    // YouTube used to return unconditionally here, which made every video page a blind
    // spot. Instead its text signal is dropped (that was the real false-positive source)
    // and the title bar is raised, so a search results page full of explicit titles can
    // still trigger while an ordinary video cannot.
    const titleBar = onYouTube ? profile.titleScore * 1.5 : profile.titleScore;

    // 2. Explicit destination sites — titles everywhere except aggregated home feeds,
    // where the titles belong to strangers' posts rather than to a chosen destination.
    if (riskyEnvironment && !isHomeFeed(url) && scores.title >= titleBar) {
      reportVerdict(false, 5);
      triggerRedirect("Explicit titles detected across page");
      return;
    }

    // 3. Adult environment plus explicit content, gated on the page being a post or a
    // chosen listing.
    // textBlocksPage() is what keeps a page ABOUT explicit content from being treated
    // as a page OF it. Title evidence is left on its own terms: explicit headings are
    // what a hosting page looks like, whatever its prose claims.
    if (
      riskyEnvironment && textScannable && !onYouTube &&
      (textBlocksPage(evidence, profile) || scores.title >= profile.titleScore - 2)
    ) {
      reportVerdict(false, 5);
      triggerRedirect("Adult environment + explicit content detected");
      return;
    }

    reportVerdict(true, riskLevel(scores, profile));
  } catch (error) {
    console.error("CleanTab scan error:", error);
    // Never let a detection failure break the page.
  }
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
  await refreshPolicy();
  scan();
  if (policy.dwellEnabled) startDwellObserver();
}

// document_idle frequently runs AFTER the load event has already fired, in which case a
// bare load listener never runs and the page is never scanned at all. Cover both.
if (document.readyState === "complete") {
  init();
} else {
  window.addEventListener("load", init, { once: true });
  // Fallback for pages whose load event never settles (long-polling, stalled subresources).
  if (document.readyState !== "loading") setTimeout(init, 1500);
}

// SPA navigation (YouTube, Twitter, Reddit…)
let lastUrl = location.href;

async function handleNavigation() {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  redirectTriggered = false;
  await refreshPolicy(); // allowances and pauses are URL-scoped
  debouncedScan(500);
}

setInterval(handleNavigation, 1000);
window.addEventListener("popstate", () => setTimeout(handleNavigation, 300));

// Re-read policy when settings change so sensitivity and trust take effect without a
// reload. Content scripts can read storage.local directly; the policy itself still comes
// from the worker so the session-scoped parts stay in one place.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.enabled || changes.trustedSites || changes.sensitivity ||
      changes.disableUntil || changes.enableDwellDetection) {
    refreshPolicy().then(() => debouncedScan(100));
  }
});

// ── Cross-origin image encode fallback (plan §8.4.3) ───────────────────────────
//
// Some CDNs reject the worker's credential-less fetch. The page already has the bytes,
// so it re-encodes them through a canvas. Only works for images the page loaded with
// CORS access; tainted canvases throw and we report failure honestly rather than "safe".

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== "encodeImage") return false;
  try {
    const img = [...document.images].find((i) => i.src === msg.src);
    if (!img || !img.complete || !img.naturalWidth) { sendResponse({ dataUrl: null }); return true; }
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d").drawImage(img, 0, 0);
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
const CLASSIFY_RATE_MS = 3000;
const OBSERVE_DEBOUNCE_MS = 400;

let isPageScrolling = false;
let scrollStopTimeout;
window.addEventListener("scroll", () => {
  isPageScrolling = true;
  clearTimeout(scrollStopTimeout);
  scrollStopTimeout = setTimeout(() => { isPageScrolling = false; }, 250);
}, { passive: true });

let dwellClassifyInFlight = false;
let dwellClassifyQueued = null;
let dwellLastClassifyTime = 0;

function dispatchImageClassification(src) {
  dwellClassifyInFlight = true;
  dwellLastClassifyTime = Date.now();

  chrome.runtime.sendMessage({ action: "classifyImage", src }, (response) => {
    dwellClassifyInFlight = false;
    if (chrome.runtime.lastError) return;
    if (response?.unsafe && !scanningSuppressed() && !redirectTriggered) {
      triggerRedirect("Dwelled on flagged image content");
    }
    if (dwellClassifyQueued) {
      const nextSrc = dwellClassifyQueued;
      dwellClassifyQueued = null;
      const delay = Math.max(0, CLASSIFY_RATE_MS - (Date.now() - dwellLastClassifyTime));
      setTimeout(() => dispatchImageClassification(nextSrc), delay);
    }
  });
}

function requestImageClassification(src) {
  if (!src || src.startsWith("data:") || src.startsWith("blob:")) return;
  const now = Date.now();
  if (dwellClassifyInFlight || (now - dwellLastClassifyTime) < CLASSIFY_RATE_MS) {
    dwellClassifyQueued = src;
    return;
  }
  dispatchImageClassification(src);
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
      if (clearedImages.has(img)) return;

      if (entry.isIntersecting) {
        const tid = setTimeout(() => {
          if (!isPageScrolling && !redirectTriggered && !scanningSuppressed() && img.src) {
            clearedImages.add(img);
            requestImageClassification(img.src);
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
