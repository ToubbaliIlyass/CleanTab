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

const adultAnchors = new Set([
  "porn",
  "nsfw",
  "xxx",
  "cam",
  "cams",
  "hentai",
  "bdsm",
  "nude",
]);

const adultContext = new Set([
  "model",
  "models",
  "private",
  "room",
  "girls",
  "chat",
  "show",
  "studio",
]);

function getKeywordScore(text) {
  let score = 0;
  const lower = text.toLowerCase();

  for (const [keyword, weight] of Object.entries(keywordWeights)) {
    if (lower.includes(keyword)) {
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

///////////////////////////////
// URL Scoring (Strong Signal)
///////////////////////////////
function getURLScore(url) {
  let score = 0;
  const lower = url.toLowerCase();

  // Use consistent keyword scoring
  score += getKeywordScore(lower);

  // ---- Search Query Intent ---- //
  try {
    const params = new URL(url).searchParams;

    for (const [key, value] of params.entries()) {
      const v = (value || "").toLowerCase();
      // Add extra weight for search intent
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

    // Environment without intent should never redirect
    if (riskyEnvironment && !inside) {
      // context only, wait for intent
    }

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

    // ----------------------------------
    // 2. YouTube-specific logic
    // ----------------------------------

    // Only flag YouTube if EXPLICIT SEARCH intent
    if (isYouTubeSearch(url) && urlScore >= 5) {
      redirectTriggered = true;
      chrome.runtime.sendMessage({
        action: "redirect",
        reason: "YouTube search intent matched high-risk keywords",
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
