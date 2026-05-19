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

chrome.runtime.onInstalled.addListener((details) => {
  bootstrapStorage().then(() => {
    if (details.reason === "install") {
      chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") });
    }
    handleDailyRollover();
    checkDisableTimer();
  });
});

chrome.runtime.onStartup.addListener(() => {
  bootstrapStorage().then(() => {
    handleDailyRollover();
    checkDisableTimer();
  });
});

// ── NSFW.js classification via offscreen document ─────────────────────────────

async function ensureOffscreenDoc() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL("offscreen/offscreen.html"),
    reasons: ["BLOBS"],
    justification: "Run NSFW.js image classification for content appeal review",
  });
}

async function classifyScreenshot(tabId) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: "png",
      quality: 60,
    });

    await ensureOffscreenDoc();

    return await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: "classifyScreenshot", dataUrl },
        (response) => {
          if (chrome.runtime.lastError || !response?.ok) {
            resolve(null);
          } else {
            resolve(response.result);
          }
        },
      );
    });
  } catch (e) {
    console.error("classifyScreenshot error:", e);
    return null;
  }
}

function isLikelySafe(prediction) {
  if (!prediction) return false;
  const safe = (prediction.neutral || 0) + (prediction.drawing || 0);
  return safe > 0.85;
}

function isLikelyUnsafe(prediction) {
  if (!prediction) return false;
  const unsafe = (prediction.porn || 0) + (prediction.hentai || 0) + (prediction.sexy || 0);
  return unsafe > 0.6;
}

// Inline bootstrap — migrates v0 keys to v1 schema on first run.
async function bootstrapStorage() {
  const data = await new Promise((resolve) => chrome.storage.local.get(null, resolve));
  if (data.schemaVersion) return; // Already migrated

  const dateStr = localDateKey();
  const defaults = {
    schemaVersion: 1,
    enabled: data.enabled !== false,
    disableUntil: data.disableUntil || null,
    cooldownUntil: data.cooldownUntil || null,
    safeDomains: data.safeDomains || [],
    onboardingCompleted: false,
    selfEstimateHours: null,
    goalMinutes: 120,
    today: { date: dateStr, cleanMinutes: 0, redirects: data.redirectsToday || 0, reflections: 0, ringClosedAt: null },
    history: {},
    totals: { closedDays: Math.max(0, (data.streak || 1) - 1), reflectionsLogged: 0, lifetimeCleanMinutes: 0 },
    reflections: [],
  };

  await new Promise((resolve) => chrome.storage.local.set(defaults, resolve));

  const legacyKeys = ["streak", "lastStreakDay", "redirectsToday", "streakBrokenToday", "lastReset"];
  const toRemove = legacyKeys.filter((k) => k in data);
  if (toRemove.length) {
    await new Promise((resolve) => chrome.storage.local.remove(toRemove, resolve));
  }
}

// Local-timezone date key (replaces todayKey() UTC version)
function localDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// New daily rollover for v1 schema
async function handleDailyRollover() {
  const data = await new Promise((resolve) =>
    chrome.storage.local.get(["today", "totals", "history", "goalMinutes"], resolve)
  );
  const today = data.today || {};
  const dateStr = localDateKey();

  if (today.date === dateStr) return;
  if (!today.date) {
    await new Promise((resolve) => chrome.storage.local.set({
      today: { date: dateStr, cleanMinutes: 0, redirects: 0, reflections: 0, ringClosedAt: null }
    }, resolve));
    return;
  }

  const history = data.history || {};
  const goal = data.goalMinutes || 120;
  const ringClosed = today.ringClosedAt !== null || today.cleanMinutes >= goal;

  history[today.date] = {
    cleanMinutes: today.cleanMinutes || 0,
    goalMinutes: goal,
    redirects: today.redirects || 0,
    reflections: today.reflections || 0,
    ringClosed,
  };

  const keys = Object.keys(history).sort();
  while (keys.length > 365) delete history[keys.shift()];

  const totals = data.totals || { closedDays: 0, reflectionsLogged: 0, lifetimeCleanMinutes: 0 };
  if (ringClosed) totals.closedDays += 1;
  totals.lifetimeCleanMinutes += today.cleanMinutes || 0;

  await new Promise((resolve) => chrome.storage.local.set({
    history,
    totals,
    today: { date: dateStr, cleanMinutes: 0, redirects: 0, reflections: 0, ringClosedAt: null },
  }, resolve));
}

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

chrome.runtime.onMessage.addListener((msg, sender) => {
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

  // Record in v1 schema
  chrome.storage.local.get(["today"], (data) => {
    const today = { ...(data.today || {}) };
    today.redirects = (today.redirects || 0) + 1;
    chrome.storage.local.set({ today });
  });
});

// Daily rollover alarm (every 30 min for reliability)
chrome.alarms.create("dailyRollover", { periodInMinutes: 30 });
// Clean minute tick (every 1 min)
chrome.alarms.create("cleanMinuteTick", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "dailyRollover") handleDailyRollover();
  if (alarm.name === "cleanMinuteTick") tickCleanMinute();
});

function updateBadgeArc(pct) {
  const SIZE = 48;
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const r = 19;

  // Track
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(0,0,0,0.07)";
  ctx.lineWidth = 5;
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#FF6B35";
  ctx.globalAlpha = 0.4 + pct * 0.6;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Arc fill
  if (pct > 0.01) {
    const start = -Math.PI / 2;
    const end = start + pct * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, end);
    ctx.strokeStyle = "#FF6B35";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  const imageData = ctx.getImageData(0, 0, SIZE, SIZE);
  chrome.action.setIcon({ imageData }).catch(() => {});
}

async function tickCleanMinute() {
  const data = await new Promise((resolve) =>
    chrome.storage.local.get(["enabled", "disableUntil"], resolve)
  );

  if (data.enabled === false) return;
  if (data.disableUntil && data.disableUntil > Date.now()) return;

  // Check idle state — only count if user is actively browsing
  chrome.idle.queryState(60, (state) => {
    if (state !== "active") return;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.url) return;

      // Don't count the redirect page itself
      const redirectPage = chrome.runtime.getURL("redirect/redirect.html");
      if (tab.url.startsWith(redirectPage)) return;

      chrome.storage.local.get(["today", "goalMinutes"], (stored) => {
        const today = { ...(stored.today || {}) };
        const goal = stored.goalMinutes || 120;

        today.cleanMinutes = (today.cleanMinutes || 0) + 1;

        if (!today.ringClosedAt && today.cleanMinutes >= goal) {
          today.ringClosedAt = Date.now();
        }

        chrome.storage.local.set({ today });

        // Update badge arc
        updateBadgeArc(Math.min(1, today.cleanMinutes / goal));
      });
    });
  });
}

// Fetches an image URL, converts to dataUrl, classifies via offscreen NSFW.js.
async function classifyImageUrl(src) {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    // Convert to base64 in chunks to avoid call stack overflow on large images
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    const mimeType = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
    const dataUrl = `data:${mimeType};base64,${btoa(binary)}`;

    await ensureOffscreenDoc();

    return await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "classifyBlob", dataUrl }, (r) => {
        if (chrome.runtime.lastError || !r?.ok) resolve(null);
        else resolve(r.result);
      });
    });
  } catch (e) {
    console.error("classifyImageUrl error:", e);
    return null;
  }
}

// Dwell-based image classification request from content script
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== "classifyImage") return false;
  (async () => {
    const prediction = await classifyImageUrl(msg.src);
    sendResponse({ unsafe: isLikelyUnsafe(prediction) });
  })();
  return true;
});

// Appeal handler — uses NSFW.js classifier when model files are present,
// falls back to keyword score for blocked domains otherwise.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action !== "appealRequest") return false;

  (async () => {
    try {
      const redirectUrl = new URL(sender.tab.url);
      const originalUrl = redirectUrl.searchParams.get("original");

      if (!originalUrl) {
        sendResponse({ status: "denied", reason: "No original URL found" });
        return;
      }

      const domain = new URL(originalUrl).hostname.toLowerCase().replace("www.", "");

      // Auto-deny known adult domains — no classifier needed
      if (knownAdultDomains.has(domain) || knownAdultDomains.has(`www.${domain}`)) {
        sendResponse({
          status: "denied",
          reason: "This domain is on the adult content blocklist.",
          permanent: true,
        });
        return;
      }

      // Run NSFW.js classifier on the current screenshot
      const prediction = await classifyScreenshot(sender.tab.id);

      if (!prediction) {
        // Model not set up yet — fall back to keyword score
        const score = getKeywordScore(originalUrl.toLowerCase());
        if (score < 3) {
          await addSafeDomain(domain);
          sendResponse({ status: "approved", originalUrl, reason: "Low keyword risk — approved." });
        } else {
          sendResponse({ status: "denied", reason: "Unable to run image analysis. Model files may not be installed yet (see vendor/SETUP.md)." });
        }
        return;
      }

      if (isLikelySafe(prediction)) {
        await addSafeDomain(domain);
        const neutralPct = Math.round(((prediction.neutral || 0) + (prediction.drawing || 0)) * 100);
        sendResponse({
          status: "approved",
          originalUrl,
          reason: `Image analysis: ${neutralPct}% safe content.`,
        });
      } else {
        const unsafePct = Math.round(((prediction.porn || 0) + (prediction.hentai || 0) + (prediction.sexy || 0)) * 100);
        sendResponse({
          status: "denied",
          reason: `Image analysis detected ${unsafePct}% likely adult content.`,
        });
      }
    } catch (err) {
      console.error("Appeal error:", err);
      sendResponse({ status: "denied", reason: "Appeal failed — please try again." });
    }
  })();

  return true;
});

async function addSafeDomain(domain) {
  const data = await new Promise((resolve) => chrome.storage.local.get(["safeDomains"], resolve));
  const domains = data.safeDomains || [];
  if (!domains.includes(domain)) {
    domains.push(domain);
    await new Promise((resolve) => chrome.storage.local.set({ safeDomains: domains }, resolve));
  }
}
