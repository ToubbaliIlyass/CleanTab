const MAX_DAILY_REDIRECTS = 3;

// Appeal system constants
const MAX_DAILY_APPEALS = 5;
const HIGH_CONFIDENCE_THRESHOLD = 8;
const APPEAL_COOLDOWN_HOURS = 1; // Reduced from 2 to 1 hour
const RAPID_APPEAL_THRESHOLD = 3; // Only cooldown after 3+ rapid failures

// Shared keyword weights for confidence scoring
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

// High-confidence adult domains (auto-deny appeals)
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

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// Lightweight confidence scoring for appeals
function getUrlConfidenceScore(url) {
  let score = 0;
  const lower = url.toLowerCase();

  for (const [keyword, weight] of Object.entries(keywordWeights)) {
    if (lower.includes(keyword)) {
      score += weight;
    }
  }

  // Domain-based scoring
  try {
    const domain = new URL(url).hostname.toLowerCase();
    if (
      knownAdultDomains.has(domain) ||
      knownAdultDomains.has(domain.replace("www.", ""))
    ) {
      score += 10; // Very high confidence
    }
  } catch (e) {
    // Invalid URL
  }

  return score;
}

// AI-powered content analysis for high-confidence appeals
async function analyzePageContent(tabId, url) {
  try {
    // Capture screenshot and page metadata
    const [screenshot, pageInfo] = await Promise.all([
      chrome.tabs.captureVisibleTab(null, { format: "png", quality: 50 }),
      chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({
          title: document.title,
          description:
            document.querySelector('meta[name="description"]')?.content || "",
          keywords:
            document.querySelector('meta[name="keywords"]')?.content || "",
          headings: Array.from(document.querySelectorAll("h1, h2, h3"))
            .slice(0, 5)
            .map((h) => h.textContent.trim()),
          domain: location.hostname,
          pathname: location.pathname,
        }),
      }),
    ]);

    const metadata = pageInfo[0]?.result;
    if (!metadata)
      return { safe: false, reason: "Could not analyze page content" };

    // Lightweight content analysis
    const analysis = await performLightweightAnalysis(metadata, url);

    return {
      safe: analysis.safe,
      reason: analysis.reason,
      confidence: analysis.confidence,
      metadata: {
        title: metadata.title,
        domain: metadata.domain,
        analysisTimestamp: Date.now(),
      },
    };
  } catch (error) {
    console.error("Error analyzing page content:", error);
    return { safe: false, reason: "Analysis failed - defaulting to block" };
  }
}

// Lightweight AI analysis (no external APIs required)
async function performLightweightAnalysis(metadata, url) {
  const { title, description, keywords, headings, domain } = metadata;

  // Combine all text for analysis
  const allText = [title, description, keywords, ...headings]
    .join(" ")
    .toLowerCase();

  let riskScore = 0;
  let safeSignals = 0;

  // Risk indicators
  for (const [keyword, weight] of Object.entries(keywordWeights)) {
    if (allText.includes(keyword)) {
      riskScore += weight;
    }
  }

  // Safe signals (educational, news, legitimate business)
  const safeIndicators = [
    "education",
    "university",
    "research",
    "academic",
    "study",
    "news",
    "article",
    "journal",
    "report",
    "documentation",
    "health",
    "medical",
    "therapy",
    "counseling",
    "support",
    "company",
    "business",
    "corporate",
    "official",
    "government",
  ];

  safeIndicators.forEach((indicator) => {
    if (allText.includes(indicator)) safeSignals += 1;
  });

  // Domain reputation check
  const trustedDomains = [
    "edu",
    "gov",
    "org",
    "wikipedia",
    "reddit",
    "youtube",
  ];
  const hasTrustedDomain = trustedDomains.some((tld) => domain.includes(tld));

  if (hasTrustedDomain) safeSignals += 3;

  // Decision logic
  const netScore = riskScore - safeSignals;

  if (netScore <= 2 && safeSignals >= 2) {
    return {
      safe: true,
      reason: "Content appears educational or legitimate",
      confidence: Math.min(0.9, safeSignals / 5),
    };
  }

  if (netScore >= 8) {
    return {
      safe: false,
      reason: "High risk content detected with strong adult indicators",
      confidence: Math.min(0.95, riskScore / 10),
    };
  }

  return {
    safe: false,
    reason: "Ambiguous content - defaulting to block for safety",
    confidence: 0.5,
  };
}

// Rate limiting for appeals
class AppealRateLimiter {
  constructor() {
    this.appeals = new Map(); // domain -> { count, lastAppeal, cooldownUntil }
  }

  async checkRateLimit(domain) {
    const today = todayKey();
    const now = Date.now();

    // Get stored appeal data
    const data = await new Promise((resolve) => {
      chrome.storage.local.get(
        [`appeals_${today}`, `appealCooldowns`],
        resolve,
      );
    });

    const dailyAppeals = data[`appeals_${today}`] || {};
    const cooldowns = data.appealCooldowns || {};

    // Check daily limit
    if ((dailyAppeals[domain] || 0) >= MAX_DAILY_APPEALS) {
      return { allowed: false, reason: "Daily appeal limit reached" };
    }

    // Check cooldown
    if (cooldowns[domain] && cooldowns[domain] > now) {
      const remainingHours = Math.ceil(
        (cooldowns[domain] - now) / (1000 * 60 * 60),
      );
      return {
        allowed: false,
        reason: `Appeal cooldown active. Try again in ${remainingHours} hours`,
      };
    }

    return { allowed: true };
  }

  async recordAppeal(domain, approved) {
    const today = todayKey();
    const now = Date.now();

    const data = await new Promise((resolve) => {
      chrome.storage.local.get(
        [`appeals_${today}`, `appealCooldowns`, `appealHistory_${domain}`],
        resolve,
      );
    });

    const dailyAppeals = data[`appeals_${today}`] || {};
    const cooldowns = data.appealCooldowns || {};
    const domainHistory = data[`appealHistory_${domain}`] || [];

    // Increment daily count
    dailyAppeals[domain] = (dailyAppeals[domain] || 0) + 1;

    // Track appeal history for this domain
    domainHistory.push({ timestamp: now, approved });

    // Keep only last 5 appeals for this domain
    const recentHistory = domainHistory.slice(-5);

    // Only set cooldown under specific conditions:
    if (!approved) {
      const recentFailures = recentHistory.filter(
        (h) => !h.approved && now - h.timestamp < 30 * 60 * 1000,
      ); // 30 minutes

      // Set cooldown only if:
      // 1. User has hit daily limit, OR
      // 2. User has 3+ rapid failures in 30 minutes
      if (
        dailyAppeals[domain] >= MAX_DAILY_APPEALS ||
        recentFailures.length >= RAPID_APPEAL_THRESHOLD
      ) {
        cooldowns[domain] = now + APPEAL_COOLDOWN_HOURS * 60 * 60 * 1000;
        console.log(
          `Cooldown applied for ${domain}: ${dailyAppeals[domain]} daily appeals, ${recentFailures.length} recent failures`,
        );
      }
    }

    chrome.storage.local.set({
      [`appeals_${today}`]: dailyAppeals,
      appealCooldowns: cooldowns,
      [`appealHistory_${domain}`]: recentHistory,
    });
  }
}

const appealRateLimiter = new AppealRateLimiter();

// Centralized streak management to prevent race conditions
class StreakManager {
  constructor() {
    this.processing = false;
  }

  async getStreakData() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        [
          "streak",
          "lastStreakDay",
          "redirectsToday",
          "streakBrokenToday",
          "lastReset",
        ],
        (data) => {
          resolve({
            streak: Math.max(1, data.streak || 1), // Ensure streak is never less than 1
            lastStreakDay: data.lastStreakDay,
            redirectsToday: data.redirectsToday || 0,
            streakBrokenToday: data.streakBrokenToday || false,
            lastReset: data.lastReset,
          });
        },
      );
    });
  }

  async updateStreakData(updates) {
    return new Promise((resolve) => {
      // Validate streak value
      if (updates.streak !== undefined) {
        updates.streak = Math.max(1, updates.streak);
      }

      chrome.storage.local.set(updates, () => {
        console.log("Streak data updated:", updates);
        resolve();
      });
    });
  }

  async handleDailyRollover() {
    if (this.processing) return;
    this.processing = true;

    try {
      const data = await this.getStreakData();
      const today = todayKey();

      // Skip if already processed today
      if (data.lastStreakDay === today) {
        this.processing = false;
        return;
      }

      // Calculate days passed
      let daysPassed = 1;
      if (data.lastStreakDay) {
        const lastDate = new Date(data.lastStreakDay);
        const todayDate = new Date(today);
        daysPassed = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));
      }

      let newStreak;
      if (daysPassed === 1) {
        // Consecutive day - check if streak should continue
        newStreak = data.streakBrokenToday ? 1 : data.streak + 1;
      } else if (daysPassed > 1) {
        // Missed day(s) - reset streak
        newStreak = 1;
      } else {
        // Same day or future date (shouldn't happen) - maintain current streak
        newStreak = data.streak;
      }

      await this.updateStreakData({
        streak: newStreak,
        lastStreakDay: today,
        redirectsToday: 0,
        streakBrokenToday: false,
        lastReset: today,
      });
    } catch (error) {
      console.error("Error handling daily rollover:", error);
    } finally {
      this.processing = false;
    }
  }

  async incrementRedirects() {
    if (this.processing) return;
    this.processing = true;

    try {
      const data = await this.getStreakData();
      const today = todayKey();

      // Ensure we're on the current day
      let redirectsToday = data.lastReset === today ? data.redirectsToday : 0;
      redirectsToday += 1;

      const updates = {
        redirectsToday,
        lastReset: today,
      };

      // Check if streak should be broken
      if (redirectsToday > MAX_DAILY_REDIRECTS && !data.streakBrokenToday) {
        updates.streakBrokenToday = true;
        console.log(
          "Streak will be reset tomorrow due to exceeding daily limit",
        );
      }

      await this.updateStreakData(updates);
    } catch (error) {
      console.error("Error incrementing redirects:", error);
    } finally {
      this.processing = false;
    }
  }
}

const streakManager = new StreakManager();

// Legacy function for compatibility
function checkDailyRollover() {
  streakManager.handleDailyRollover();
}

chrome.runtime.onInstalled.addListener(() => {
  // Initialize with safe defaults only if not already set
  chrome.storage.local.get(["streak", "lastStreakDay"], (data) => {
    const updates = {};
    const today = todayKey();

    if (!data.streak) updates.streak = 1;
    if (!data.lastStreakDay) updates.lastStreakDay = today;
    if (!data.redirectsToday) updates.redirectsToday = 0;
    if (data.streakBrokenToday === undefined) updates.streakBrokenToday = false;
    if (!data.lastReset) updates.lastReset = today;

    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }

    // Handle rollover on installation
    streakManager.handleDailyRollover();
  });

  // Check for expired disable timer on installation
  checkDisableTimer();
});

chrome.runtime.onStartup.addListener(() => {
  streakManager.handleDailyRollover();
  checkDisableTimer(); // Check for expired disable timer on startup
});

// Check and handle expired disable timer
function checkDisableTimer() {
  chrome.storage.local.get(["enabled", "disableUntil"], (data) => {
    if (data.enabled === false && data.disableUntil) {
      const now = Date.now();
      if (data.disableUntil <= now) {
        // Timer expired, re-enable extension
        chrome.storage.local.remove("disableUntil", () => {
          chrome.storage.local.set({ enabled: true }, () => {
            console.log("CleanTab auto-enabled after disable timer expired");
          });
        });
      } else {
        // Timer still active, schedule next check
        const remainingMs = data.disableUntil - now;
        const checkInterval = Math.min(remainingMs + 1000, 60000); // Check at expiry or every minute, whichever is sooner
        setTimeout(checkDisableTimer, checkInterval);
      }
    }
  });
}

// Create alarm to periodically check disable timer
chrome.alarms.create("checkDisableTimer", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkDisableTimer") {
    checkDisableTimer();
  }
});

// Developer command to clear appeal data
async function clearAppealData() {
  const today = todayKey();

  chrome.storage.local.get(null, (data) => {
    const keysToRemove = Object.keys(data).filter(
      (key) =>
        key.startsWith("appealHistory_") ||
        key.startsWith("appeals_") ||
        key === "appealCooldowns",
    );

    chrome.storage.local.remove(keysToRemove, () => {
      console.log("✅ All appeal data cleared:", keysToRemove);
    });
  });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === "syncDaily") {
    streakManager.handleDailyRollover();
    return;
  }

  if (msg.action === "clearAppealData") {
    clearAppealData();
    return;
  }

  if (msg.action !== "redirect" || !sender.tab?.id) return;

  const originalUrl = sender.tab.url;

  const params = new URLSearchParams();
  if (msg.reason) {
    params.set("reason", msg.reason);
  }
  params.set("original", originalUrl);

  const reasonParam = "?" + params.toString();

  chrome.tabs.update(sender.tab.id, {
    url: chrome.runtime.getURL("redirect/redirect.html" + reasonParam),
  });

  // Use the centralized streak manager
  streakManager.incrementRedirects();
});

// Create alarm to check daily rollover every 30 minutes for better reliability
chrome.alarms.create("dailyStreakCheck", { periodInMinutes: 30 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "dailyStreakCheck") {
    streakManager.handleDailyRollover();
  }
});

// Enhanced appeal system with confidence-based validation
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action !== "appealRequest") return false;

  // Handle appeal processing asynchronously
  (async () => {
    try {
      const redirectUrl = new URL(sender.tab.url);
      const originalUrl = redirectUrl.searchParams.get("original");

      if (!originalUrl) {
        console.log("No original URL found in appeal request");
        sendResponse({ status: "denied", reason: "No original URL found" });
        return;
      }

      const domain = new URL(originalUrl).hostname;
      const confidenceScore = getUrlConfidenceScore(originalUrl);
      console.log(
        `Processing appeal for ${domain} - Confidence: ${confidenceScore}`,
      );

      // Check rate limiting
      const rateLimitCheck = await appealRateLimiter.checkRateLimit(domain);
      if (!rateLimitCheck.allowed) {
        console.log(`Rate limit exceeded for ${domain}`);
        sendResponse({
          status: "denied",
          reason: rateLimitCheck.reason,
          cooldown: true,
        });
        await appealRateLimiter.recordAppeal(domain, false);
        return;
      }

      // Auto-deny known adult domains
      if (
        knownAdultDomains.has(domain) ||
        knownAdultDomains.has(domain.replace("www.", ""))
      ) {
        console.log(`Adult domain auto-denied: ${domain}`);
        sendResponse({
          status: "denied",
          reason: "Domain is on the adult content blocklist",
          permanent: true,
        });
        await appealRateLimiter.recordAppeal(domain, false);
        return;
      }

      // Low confidence - auto-approve
      if (confidenceScore < 3) {
        console.log(`Low confidence auto-approval for ${domain}`);

        // Use promise-based approach for storage
        const data = await new Promise((resolve) => {
          chrome.storage.local.get(["safeDomains"], resolve);
        });

        const safeDomains = data.safeDomains || [];
        if (!safeDomains.includes(domain)) {
          safeDomains.push(domain);
          await new Promise((resolve) => {
            chrome.storage.local.set({ safeDomains }, resolve);
          });
        }

        sendResponse({
          status: "approved",
          originalUrl: originalUrl,
          reason: "Low risk content - automatically approved",
        });

        await appealRateLimiter.recordAppeal(domain, true);
        return;
      }

      // High confidence - requires AI analysis
      if (confidenceScore >= HIGH_CONFIDENCE_THRESHOLD) {
        console.log(
          `High confidence appeal for ${domain} - starting AI analysis`,
        );

        try {
          const analysisResult = await analyzePageContent(
            sender.tab.id,
            originalUrl,
          );

          if (analysisResult.safe && analysisResult.confidence > 0.7) {
            console.log(
              `AI approved appeal for ${domain}:`,
              analysisResult.reason,
            );

            // Use promise-based storage
            const data = await new Promise((resolve) => {
              chrome.storage.local.get(["safeDomains"], resolve);
            });

            const safeDomains = data.safeDomains || [];
            if (!safeDomains.includes(domain)) {
              safeDomains.push(domain);
              await new Promise((resolve) => {
                chrome.storage.local.set({ safeDomains }, resolve);
              });
            }

            sendResponse({
              status: "approved",
              originalUrl: originalUrl,
              reason: `AI analysis: ${analysisResult.reason}`,
              aiApproved: true,
            });

            await appealRateLimiter.recordAppeal(domain, true);
            return;
          } else {
            console.log(
              `AI denied appeal for ${domain}:`,
              analysisResult.reason,
            );
            sendResponse({
              status: "denied",
              reason: `AI analysis: ${analysisResult.reason}`,
              confidence: analysisResult.confidence,
              aiAnalyzed: true,
            });

            await appealRateLimiter.recordAppeal(domain, false);
            return;
          }
        } catch (error) {
          console.error("AI analysis failed:", error);
          sendResponse({
            status: "denied",
            reason: "Unable to analyze content - defaulting to block",
            error: true,
          });

          await appealRateLimiter.recordAppeal(domain, false);
          return;
        }
      }

      // Medium confidence - manual review mode (deny with explanation)
      console.log(`Medium confidence denial for ${domain}`);
      sendResponse({
        status: "denied",
        reason:
          "Content appears to contain adult material. If this is incorrect, please try again later.",
        confidence: confidenceScore,
        reviewable: true,
      });

      await appealRateLimiter.recordAppeal(domain, false);
    } catch (error) {
      console.error("Appeal processing error:", error);
      sendResponse({
        status: "denied",
        reason: "Appeal processing failed",
        error: true,
      });
    }
  })();

  return true; // Keep message channel open for async response
});
