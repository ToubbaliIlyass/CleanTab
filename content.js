///////////////////////////////
// CleanTab — Content Script v0.4
// Context-aware, SPA-safe, scoring-based NSFW blocker
///////////////////////////////

// ----- Keyword Lists ----- //
const strongKeywords = [
  "porn",
  "xxx",
  "sex",
  "hentai",
  "fuck",
  "blowjob",
  "hardcore",
  "bdsm",
];
const mildKeywords = [
  "nsfw",
  "18+",
  "explicit",
  "nude",
  "onlyfans",
  "lewd",
  "thirst",
  "sexy",
];

///////////////////////////////
// Detect Inside-Post Context
///////////////////////////////
function isInsidePost(url) {
  url = url.toLowerCase();

  return (
    url.includes("/comments/") || // Reddit post
    url.includes("/status/") || // Twitter post
    url.includes("/p/") || // Instagram post
    url.includes("watch?v=") || // YouTube video
    url.includes("/post/") || // Generic post
    url.match(/reddit\.com\/r\/[^\/]+\/comments/) // stronger Reddit post detection
  );
}

///////////////////////////////
// URL Scoring (Strong Signal)
///////////////////////////////
function getURLScore(url) {
  let score = 0;
  const lower = url.toLowerCase();

  // Strong URL matches
  strongKeywords.forEach((k) => {
    if (lower.includes(k)) score += 5;
  });

  // Mild URL matches
  mildKeywords.forEach((k) => {
    if (lower.includes(k)) score += 2;
  });

  // ---- Search Query Intent ---- //
  try {
    const params = new URL(url).searchParams;

    for (const [key, value] of params.entries()) {
      const v = (value || "").toLowerCase();

      strongKeywords.forEach((k) => {
        if (v.includes(k)) score += 5; // Intent: strong
      });

      mildKeywords.forEach((k) => {
        if (v.includes(k)) score += 3; // Intent: mild
      });
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
  let score = 0;

  strongKeywords.forEach((k) => {
    if (text.includes(k)) score += 2;
  });

  mildKeywords.forEach((k) => {
    if (text.includes(k)) score += 1;
  });

  return score;
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
  const url = window.location.href;
  const inside = isInsidePost(url);

  const urlScore = getURLScore(url);
  const textScore = getTextScore();

  // 1. URL-based redirect (Strong intent)
  if (urlScore >= 5) {
    chrome.runtime.sendMessage({ action: "redirect" });
    return;
  }

  // 2. Text-based detection only inside posts
  if (inside && textScore >= 3) {
    chrome.runtime.sendMessage({ action: "redirect" });
    return;
  }

  // 3. Ignore scanning on feeds
  if (isFeedPage(url)) return;
}

///////////////////////////////
// SPA Navigation Detection (Essential)
///////////////////////////////
(function () {
  const originalPushState = history.pushState;
  history.pushState = function () {
    originalPushState.apply(this, arguments);
    window.dispatchEvent(new Event("urlchange"));
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function () {
    originalReplaceState.apply(this, arguments);
    window.dispatchEvent(new Event("urlchange"));
  };

  window.addEventListener("popstate", () => {
    window.dispatchEvent(new Event("urlchange"));
  });
})();

// Trigger scan on SPA navigation
window.addEventListener("urlchange", () => {
  setTimeout(scan, 300);
});

///////////////////////////////
// MutationObserver Fallback (DOM updates)
///////////////////////////////
window.addEventListener("load", () => {
  // Don’t scan feed pages immediately
  if (!isFeedPage(window.location.href)) {
    setTimeout(scan, 500);
  }

  const observer = new MutationObserver(() => {
    scan();
  });

  observer.observe(document.body, { childList: true, subtree: true });
});

///////////////////////////////
// URL Interval Watcher (Backup)
///////////////////////////////
let lastURL = location.href;

setInterval(() => {
  if (location.href !== lastURL) {
    lastURL = location.href;
    setTimeout(scan, 300);
  }
}, 250);
