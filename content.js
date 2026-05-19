///////////////////////////////
// CleanTab — Content Script v0.4
// Context-aware, SPA-safe, scoring-based NSFW blocker
///////////////////////////////

// ----- Keyword Lists ----- //

function resetRedirectProtection() {
  redirectTriggered = false;
}

let extensionEnabled = true;

let safeDomains = [];

chrome.storage.local.get(["safeDomains"], (data) => {
  safeDomains = data.safeDomains || [];
});

// Replace the storage listeners section

let storageListenerActive = false;

function initializeStorage() {
  if (storageListenerActive) return;

  // Get initial values
  chrome.storage.local.get(["safeDomains", "enabled"], (data) => {
    safeDomains = data.safeDomains || [];
    extensionEnabled = data.enabled !== false;
  });

  // Single listener for all storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    if (changes.safeDomains) {
      safeDomains = changes.safeDomains.newValue || [];
    }

    if (changes.enabled) {
      extensionEnabled = changes.enabled.newValue !== false;
      console.log("CleanTab enabled state changed:", extensionEnabled);
    }
  });

  storageListenerActive = true;
}

// Initialize once
initializeStorage();

let redirectTriggered = false;
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
  nude: 3,

  // Medium confidence (3 points)

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

// ----- Environment keyword clusters ----- //

// Strong adult anchors (REQUIRED)
const adultAnchorWords = [
  "porn",
  "nsfw",
  "xxx",
  "cam",
  "cams",
  "hentai",
  "blowjob",
  "bdsm",
  "nude",
];

// Adult context words (only count if anchor exists)
const adultContextWords = [
  "model",
  "models",
  "private",
  "room",
  "girls",
  "chat",
  "show",
  "studio",
];

// Neutral media words (AMPLIFIERS only)
const mediaWords = ["video", "videos", "live", "stream", "watch"];

///////////////////////////////
// Detect Inside-Post Context
///////////////////////////////
function isInsidePost(url) {
  const lower = url.toLowerCase();

  const postPatterns = [
    /\/comments\/\w+/, // Reddit posts
    /\/status\/\d+/, // Twitter posts
    /\/p\/[\w-]+/, // Instagram posts
    /watch\?v=[\w-]+/, // YouTube videos
    /\/post\/[\w-]+/, // Generic posts
    /\/posts\/\d+/, // Forum posts
    /article\/[\w-]+/, // News articles
  ];

  return postPatterns.some((pattern) => pattern.test(lower));
}

function isYouTube(url) {
  return url.includes("youtube.com");
}

function isYouTubeSearch(url) {
  return url.includes("youtube.com/results");
}

const PASSTHROUGH_PARAMS = new Set([
  "continue", "redirect_uri", "redirect", "next", "return_to",
  "returnto", "state", "url", "dest", "destination", "goto",
]);

///////////////////////////////
// URL Scoring (Strong Signal)
///////////////////////////////
function getURLScore(url) {
  let score = 0;
  const lower = url.toLowerCase();

  score += getKeywordScore(lower);

  try {
    const params = new URL(url).searchParams;

    for (const [key, value] of params.entries()) {
      if (PASSTHROUGH_PARAMS.has(key.toLowerCase())) continue;
      const v = (value || "").toLowerCase();
      score += getKeywordScore(v) * 1.5;
    }
  } catch (e) {
    // some URLs crash URL parser — safe to ignore
  }

  return score;
}

///////////////////////////////
// Text Scoring (Weak Signal)
///////////////////////////////
function getTextScore() {
  const text = document.body.innerText.toLowerCase();
  return getKeywordScore(text);
}

function getExplicitTitleScore() {
  let score = 0;

  // More targeted selectors - avoid scanning ALL spans
  const elements = document.querySelectorAll(
    'h1, h2, h3, title, [class*="title"], [class*="headline"], a[href*="/"], figcaption',
  );

  // Limit scanning to prevent performance issues
  const maxElements = Math.min(elements.length, 50);

  for (let i = 0; i < maxElements; i++) {
    const text = (
      elements[i].innerText ||
      elements[i].textContent ||
      ""
    ).toLowerCase();
    if (!text || text.length > 200) continue; // Skip very long text

    // Use consistent keyword scoring with higher weights for titles
    score += getKeywordScore(text) * 1.5;

    // Early exit if score is high enough
    if (score >= 15) break;
  }

  return score;
}

function getEnvironmentScore() {
  let anchorCount = 0;
  let score = 0;

  const elements = document.querySelectorAll(
    "h1, h2, h3, a, button, span, label",
  );

  elements.forEach((el) => {
    const text = (el.innerText || "").toLowerCase();
    if (!text) return;

    adultAnchorWords.forEach((w) => {
      if (text.includes(w)) {
        anchorCount += 1;
        score += 3;
      }
    });

    // Only amplify if at least one adult anchor exists
    if (anchorCount > 0) {
      adultContextWords.forEach((w) => {
        if (text.includes(w)) score += 1;
      });

      mediaWords.forEach((w) => {
        if (text.includes(w)) score += 1;
      });
    }
  });

  // Require at least one anchor AND sufficient total score
  if (anchorCount >= 1 && score >= 5) {
    return score;
  }

  return 0;
}

///////////////////////////////
// Feed Detection (Avoid False Positives)
///////////////////////////////
function isFeedPage(url) {
  url = url.toLowerCase();

  // Reddit feed & subreddit pages (not posts)
  if (url === "https://www.reddit.com/") return true;
  if (url.match(/^https:\/\/www\.reddit\.com\/r\/[^\/]+\/?$/)) return true;

  // Twitter home
  if (url.includes("twitter.com/home")) return true;

  // Instagram home
  if (url === "https://www.instagram.com/") return true;

  return false;
}

///////////////////////////////
// Scan Function (Main Logic)
///////////////////////////////
function scan() {
  try {
    if (!extensionEnabled || redirectTriggered) return;

    const domain = location.hostname;

    // Simple safe domain check - trust user's whitelist completely
    if (safeDomains.includes(domain)) {
      return;
    }

    const url = window.location.href;
    const inside = isInsidePost(url);

    const urlScore = getURLScore(url);
    const textScore = getTextScore();
    const explicitTitleScore = getExplicitTitleScore();
    const environmentScore = getEnvironmentScore();
    const riskyEnvironment = environmentScore >= 5;

    // ----------------------------------
    // 1. Strong URL intent (global)
    // ----------------------------------
    if (urlScore >= 5) {
      redirectTriggered = true;
      chrome.runtime.sendMessage({
        action: "redirect",
        reason: "Search or link contained high-risk keywords",
      });
      setTimeout(resetRedirectProtection, 1500);
      return;
    }

    // ❌ Never flag normal YouTube videos by text
    if (isYouTube(url)) {
      return;
    }

    // ----------------------------------
    // Explicit destination sites (titles everywhere)
    // ----------------------------------
    if (riskyEnvironment && !isFeedPage(url) && explicitTitleScore >= 6) {
      redirectTriggered = true;
      chrome.runtime.sendMessage({
        action: "redirect",
        reason: "Explicit titles detected across page",
      });
      setTimeout(resetRedirectProtection, 1500);
      return;
    }

    // ----------------------------------
    // 3. Text-based detection (intent-gated)
    // ----------------------------------
    if (
      riskyEnvironment &&
      inside &&
      (textScore >= 3 || explicitTitleScore >= 4)
    ) {
      redirectTriggered = true;
      chrome.runtime.sendMessage({
        action: "redirect",
        reason: "Adult environment + explicit content detected",
      });
      setTimeout(resetRedirectProtection, 1500);
      return;
    }

    // ----------------------------------
    // 4. Ignore feeds
    // ----------------------------------
    if (isFeedPage(url)) return;
  } catch (error) {
    console.error("CleanTab scan error:", error);
    // Don't block the page if extension fails
  }
}

// Only scan after full page load
window.addEventListener("load", () => {
  redirectTriggered = false;
  debouncedScan();
});

// Handle SPA navigation (YouTube, Twitter, Reddit, etc.)
let lastUrl = location.href;

function handleNavigation() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    redirectTriggered = false; // Reset for new page
    setTimeout(scan, 500); // Slight delay for content to load
  }
}

// Watch for URL changes in SPAs
setInterval(handleNavigation, 1000);

// Also listen to popstate for back/forward navigation
window.addEventListener("popstate", () => {
  setTimeout(handleNavigation, 300);
});

// Add debounced scanning

let scanTimeout;

function debouncedScan() {
  clearTimeout(scanTimeout);
  scanTimeout = setTimeout(scan, 300);
}

// ── Dwell-based image detection (visual platforms only) ───────────────────────

const VISUAL_PLATFORMS = new Set([
  "pinterest.com", "www.pinterest.com",
  "reddit.com", "www.reddit.com", "old.reddit.com",
  "twitter.com", "www.twitter.com", "x.com", "www.x.com",
  "instagram.com", "www.instagram.com",
  "tumblr.com", "www.tumblr.com",
]);

const DWELL_MS = 2000;       // pause duration before classifying
const MIN_IMAGE_PX = 180;    // skip avatars and icons
const CLASSIFY_RATE_MS = 3000; // min gap between classifications per tab

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
    if (response?.unsafe && extensionEnabled && !redirectTriggered) {
      redirectTriggered = true;
      chrome.runtime.sendMessage({ action: "redirect", reason: "Dwelled on flagged image content" });
      setTimeout(resetRedirectProtection, 1500);
    }
    // Drain one queued item after rate-limit delay
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
    dwellClassifyQueued = src; // keep only the latest
    return;
  }
  dispatchImageClassification(src);
}

function startDwellObserver() {
  if (!VISUAL_PLATFORMS.has(location.hostname)) return;

  const dwellTimers = new WeakMap();
  const clearedImages = new WeakSet();

  const intersectionObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const img = entry.target;
      if (clearedImages.has(img)) return;

      if (entry.isIntersecting) {
        const tid = setTimeout(() => {
          // Only fire if user is still — not mid-scroll
          if (!isPageScrolling && !redirectTriggered && extensionEnabled && img.src) {
            clearedImages.add(img); // mark so we don't re-queue it
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

  function observeImages() {
    document.querySelectorAll("img").forEach((img) => {
      if (dwellTimers.has(img) || clearedImages.has(img)) return;
      const check = () => {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (w >= MIN_IMAGE_PX || h >= MIN_IMAGE_PX) {
          intersectionObserver.observe(img);
        }
      };
      if (img.complete) check();
      else img.addEventListener("load", check, { once: true });
    });
  }

  observeImages();

  // Pick up images added by infinite-scroll feeds
  const mutationObserver = new MutationObserver(observeImages);
  mutationObserver.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startDwellObserver);
} else {
  startDwellObserver();
}
