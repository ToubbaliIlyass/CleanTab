///////////////////////////////
// CleanTab — service worker
///////////////////////////////

importScripts(
  "shared/dates.js",
  "shared/domains.js",
  "shared/thresholds.js",
  "shared/keywords.js",
  "shared/scoring.js",
  "shared/pageshape.js",
  "shared/review.js",
  "shared/schema.js",
  "shared/lock.js",
  "shared/migrations/v0_to_v1.js",
  "shared/migrations/v1_to_v2.js",
  "shared/storage.js",
);

// knownAdultDomains comes from shared/keywords.js — auto-denies appeals.

// ── Lifecycle ─────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  bootstrap().then(() => {
    if (details.reason === "install") {
      chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") });
    }
    handleDailyRollover();
    checkDisableTimer();
  });
});

chrome.runtime.onStartup.addListener(() => {
  bootstrap().then(() => {
    handleDailyRollover();
    checkDisableTimer();
  });
});

chrome.alarms.create("dailyRollover", { periodInMinutes: 30 });
chrome.alarms.create("minuteTick", { periodInMinutes: 1 });
chrome.alarms.create("checkDisableTimer", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "dailyRollover") handleDailyRollover().then(recalibrateGoal);
  if (alarm.name === "minuteTick") tickMinuteForActiveTab();
  if (alarm.name === "checkDisableTimer") checkDisableTimer();
});

function checkDisableTimer() {
  chrome.storage.local.get(["enabled", "disableUntil"], (data) => {
    if (data.enabled !== false || !data.disableUntil) return;
    if (data.disableUntil <= Date.now()) {
      chrome.storage.local.remove("disableUntil", () => {
        chrome.storage.local.set({ enabled: true }, () => refreshBadge());
      });
    }
  });
}

// ── Managed policy ────────────────────────────────────────────────────────────
//
// chrome.storage.managed is empty unless an administrator set a policy, and throws on
// platforms without policy support. Either way the answer is "no policy", never an
// error that breaks detection.
function managedGet() {
  return new Promise((resolve) => {
    try {
      chrome.storage.managed.get(null, (values) => {
        void chrome.runtime.lastError;
        resolve(values || {});
      });
    } catch {
      resolve({});
    }
  });
}

// ── Detection health (plan §9 Phase 19) ───────────────────────────────────────
//
// Every failure path used to resolve to "safe" and say nothing, so a broken detector was
// indistinguishable from a working one that found nothing. We track enough to tell the
// user which one they have.

const health = {
  modelState: "unknown", // unknown | ready | unavailable
  lastError: null,
  fetchFailures: 0,
};

async function publishHealth() {
  await sessionSet({ detectionHealth: { ...health, ts: Date.now() } });
}

// ── Offscreen classifier ──────────────────────────────────────────────────────

let offscreenCreating = null;

async function ensureOffscreenDoc() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (contexts.length > 0) return;
  // Concurrent callers would otherwise race and throw "Only a single offscreen document
  // may be created" — the dwell path and the appeal path can fire together.
  if (offscreenCreating) return offscreenCreating;
  offscreenCreating = chrome.offscreen.createDocument({
    url: chrome.runtime.getURL("offscreen/offscreen.html"),
    reasons: ["BLOBS"],
    justification: "Run local NSFW.js image classification",
  }).finally(() => { offscreenCreating = null; });
  return offscreenCreating;
}

function askOffscreen(message, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      health.modelState = "unavailable";
      health.lastError = "Classifier timed out";
      publishHealth();
      resolve(null);
    }, timeoutMs);

    chrome.runtime.sendMessage(message, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (chrome.runtime.lastError || !response?.ok) {
        health.modelState = "unavailable";
        health.lastError = chrome.runtime.lastError?.message || response?.error || "unknown";
        publishHealth();
        resolve(null);
      } else {
        health.modelState = "ready";
        health.lastError = null;
        publishHealth();
        resolve(response.result);
      }
    });
  });
}

// Converts an image response body to a dataURL the offscreen document can decode.
function bytesToDataUrl(bytes, mimeType) {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function classifyImageUrl(src) {
  try {
    const res = await fetch(src);
    if (!res.ok) { health.fetchFailures += 1; publishHealth(); return null; }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 1024) return null; // tracking pixels, spacers
    const mimeType = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
    if (!mimeType.startsWith("image/") || mimeType.includes("svg")) return null;

    await ensureOffscreenDoc();
    return await askOffscreen({ action: "classifyBlob", dataUrl: bytesToDataUrl(bytes, mimeType) });
  } catch (e) {
    health.fetchFailures += 1;
    publishHealth();
    return null;
  }
}

// Content-script fallback for CDNs that reject a credential-less background fetch
// (plan §8.4.3). The page already has the bytes decoded; it re-encodes via canvas.
async function classifyViaContentScript(tabId, src) {
  const dataUrl = await new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: "encodeImage", src }, (r) => {
      resolve(chrome.runtime.lastError ? null : r?.dataUrl || null);
    });
  });
  if (!dataUrl) return null;
  await ensureOffscreenDoc();
  return await askOffscreen({ action: "classifyBlob", dataUrl });
}

function unsafeScore(prediction) {
  if (!prediction) return 0;
  return (prediction.porn || 0) + (prediction.hentai || 0) + (prediction.sexy || 0);
}

// ── Redirect ──────────────────────────────────────────────────────────────────
//
// The blocked URL is kept in session storage keyed by tab, not in the redirect page's
// query string. It used to land in the omnibox, in history and in session restore —
// for a tool whose whole point is NSFW content, that was the wrong default.

const BLOCKED_KEY = "blockedByTab";

async function stashBlocked(tabId, url, reason) {
  const data = await sessionGet([BLOCKED_KEY]);
  const map = data[BLOCKED_KEY] || {};
  map[tabId] = { url, reason, ts: Date.now() };
  await sessionSet({ [BLOCKED_KEY]: map });
}

async function readBlocked(tabId) {
  const data = await sessionGet([BLOCKED_KEY]);
  return (data[BLOCKED_KEY] || {})[tabId] || null;
}

async function redirectTab(tabId, url, reason) {
  await stashBlocked(tabId, url, reason);
  await recordBlock(domainFromUrl(url), reason);
  chrome.tabs.update(tabId, { url: chrome.runtime.getURL("redirect/redirect.html") });
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const data = await sessionGet([BLOCKED_KEY, VERDICT_KEY]);
  const blocked = data[BLOCKED_KEY] || {};
  const verdicts = data[VERDICT_KEY] || {};
  delete blocked[tabId];
  delete verdicts[tabId];
  await sessionSet({ [BLOCKED_KEY]: blocked, [VERDICT_KEY]: verdicts });
});

// ── Per-tab scan verdicts (plan §9 Phase 14) ──────────────────────────────────

const VERDICT_KEY = "tabVerdicts";

async function setVerdict(tabId, verdict) {
  const data = await sessionGet([VERDICT_KEY]);
  const map = data[VERDICT_KEY] || {};
  map[tabId] = { ...verdict, ts: Date.now() };
  await sessionSet({ [VERDICT_KEY]: map });
}

async function getVerdict(tabId) {
  const data = await sessionGet([VERDICT_KEY]);
  return (data[VERDICT_KEY] || {})[tabId] || null;
}

// ── Minute tracking ───────────────────────────────────────────────────────────

const VERDICT_FRESH_MS = 2 * 60 * 1000;

async function tickMinuteForActiveTab() {
  const data = await storageGet(["enabled", "disableUntil"]);
  if (data.enabled === false) return;
  if (data.disableUntil && data.disableUntil > Date.now()) return;

  const state = await new Promise((r) => chrome.idle.queryState(60, r));
  if (state !== "active") return;

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !tab.url || !tab.id) return;

  // The redirect page is not browsing.
  if (tab.url.startsWith(chrome.runtime.getURL("redirect/redirect.html"))) return;

  const verdict = await getVerdict(tab.id);
  // No verdict means we could not scan this tab — chrome://, the PDF viewer, the web
  // store. That is neutral, not virtuous: it advances neither counter. Counting it was
  // what made the old "clean minutes" number meaningless.
  if (!verdict || Date.now() - verdict.ts > VERDICT_FRESH_MS) return;

  const today = await tickMinute(verdict.clean);
  refreshBadge(today);
}

// ── Badge ─────────────────────────────────────────────────────────────────────

function drawBadgeArc(pct, dimmed) {
  const SIZE = 48;
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  const c = SIZE / 2;
  const r = 19;
  const accent = dimmed ? "#B5AFA7" : "#FF6B35";

  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(0,0,0,0.07)";
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(c, c, 4, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.globalAlpha = dimmed ? 0.5 : 0.4 + pct * 0.6;
  ctx.fill();
  ctx.globalAlpha = 1;

  if (pct > 0.01) {
    const start = -Math.PI / 2;
    ctx.beginPath();
    ctx.arc(c, c, r, start, start + pct * Math.PI * 2);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  chrome.action.setIcon({ imageData: ctx.getImageData(0, 0, SIZE, SIZE) }).catch(() => {});
}

// Repaints from stored state. The old version painted once per tick and left a stale arc
// up through rollover and through a pause.
async function refreshBadge(todayArg) {
  const data = await storageGet(["today", "enabled", "disableUntil"]);
  const today = todayArg || data.today || {};
  const paused = data.enabled === false ||
    (data.disableUntil && data.disableUntil > Date.now());
  drawBadgeArc(cleanShare(today), paused);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.enabled || changes.disableUntil || changes.cleanShareGoal) refreshBadge();
});

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = HANDLERS[msg?.action];
  if (!handler) return false;
  Promise.resolve(handler(msg, sender)).then(sendResponse).catch((err) => {
    console.error(`CleanTab ${msg.action} failed:`, err);
    sendResponse({ error: String(err?.message || err) });
  });
  return true; // async
});

const HANDLERS = {
  // Content script asks what rules apply before it scans. One round trip at document_idle
  // and again on SPA navigation — this is what lets sensitivity, per-site pause and
  // one-time allowances all take effect without the content script touching storage.
  async getTabPolicy(msg, sender) {
    const url = msg.url || sender.tab?.url || "";
    const domain = domainFromUrl(url);
    const stored = await storageGet([
      "enabled", "disableUntil", "trustedSites", "sensitivity", "enableDwellDetection",
    ]);
    const managed = await managedGet();
    // An administrator's sensitivity and image-scanning values win over the user's.
    // Merging here rather than in the popup is what makes the policy actually govern
    // detection instead of only greying out a control.
    const data = effectiveSettings(stored, managed);

    let globallyOff = data.enabled === false ||
      Boolean(data.disableUntil && data.disableUntil > Date.now());
    // A policy that forbids disabling also invalidates a disable already in flight.
    if (managed.allowDisable === false) globallyOff = false;

    const trustedSites = [
      ...(data.trustedSites || []),
      ...(managed.lockedTrustedSites || []).map((d) => makeTrustEntry(d, "managed")),
    ];
    const profile = getProfile(data.sensitivity);

    return {
      enabled: !globallyOff,
      trusted: isTrusted(trustedSites, domain),
      sitePausedUntil: await getSitePause(domain),
      allowed: await hasAllowance(url),
      profile,
      dwellEnabled: Boolean(data.enableDwellDetection) && profile.dwell,
    };
  },

  async tabVerdict(msg, sender) {
    if (!sender.tab?.id) return { ok: false };
    await setVerdict(sender.tab.id, { clean: Boolean(msg.clean), score: msg.score || 0 });
    return { ok: true };
  },

  async redirect(msg, sender) {
    if (!sender.tab?.id || !sender.tab.url) return { ok: false };
    await redirectTab(sender.tab.id, sender.tab.url, msg.reason || "This page was flagged.");
    return { ok: true };
  },

  async classifyImage(msg, sender) {
    const data = await storageGet(["sensitivity"]);
    const profile = getProfile(data.sensitivity);
    let prediction = await classifyImageUrl(msg.src);
    if (!prediction && sender.tab?.id) {
      prediction = await classifyViaContentScript(sender.tab.id, msg.src);
    }
    if (!prediction) return { unsafe: false, inconclusive: true };
    return { unsafe: unsafeScore(prediction) > profile.unsafeProb };
  },

  // What the redirect page needs. The URL never travelled through the query string.
  async getBlockContext(msg, sender) {
    const tabId = sender.tab?.id;
    const blocked = tabId ? await readBlocked(tabId) : null;
    if (!blocked) return { reason: "This page was flagged.", domain: "", canAppeal: false };
    const managed = await managedGet();
    return {
      reason: blocked.reason,
      domain: domainFromUrl(blocked.url),
      // "Let me through once" is deliberately NOT gated here. A policy can withhold
      // permanent trust; it should not make a false positive unreachable.
      canAppeal: !knownAdultDomains.has(domainFromUrl(blocked.url)) &&
        managed.allowAppeals !== false,
    };
  },

  // "Let me through once" — 10 minutes, this URL only, session-scoped.
  async allowOnce(msg, sender) {
    const tabId = sender.tab?.id;
    const blocked = tabId ? await readBlocked(tabId) : null;
    if (!blocked) return { ok: false };
    await grantAllowance(blocked.url);
    chrome.tabs.update(tabId, { url: blocked.url });
    return { ok: true };
  },

  async appealRequest(msg, sender) {
    const tabId = sender.tab?.id;
    const blocked = tabId ? await readBlocked(tabId) : null;
    if (!blocked) return { status: "denied", reason: "Nothing to review — the original page was lost." };

    const domain = domainFromUrl(blocked.url);
    if (knownAdultDomains.has(domain)) {
      return { status: "denied", permanent: true, reason: "This domain is on the adult content blocklist." };
    }

    const managed = await managedGet();
    if (managed.allowAppeals === false) {
      return {
        status: "denied",
        permanent: true,
        reason: "Your administrator has turned off permanent site approvals.",
      };
    }

    const profile = await getSensitivityProfile();
    const result = await reviewPage(blocked.url, profile);

    if (result.verdict === "safe") {
      await addTrustedSite(domain, "appeal");
      chrome.tabs.update(tabId, { url: blocked.url });
      return {
        status: "approved",
        reason: `Checked ${result.checked} image${result.checked === 1 ? "" : "s"} on the page — nothing flagged.`,
      };
    }

    if (result.verdict === "unsafe") {
      return {
        status: "denied",
        reason: `Image analysis flagged ${Math.round(result.worst * 100)}% likely adult content.`,
      };
    }

    return {
      status: "inconclusive",
      reason: result.checked === 0
        ? "Couldn't analyze this page's images — it may load them after opening."
        : `Only ${result.checked} image${result.checked === 1 ? "" : "s"} could be checked. Not enough to clear it.`,
    };
  },

  async getHealth() {
    const data = await sessionGet(["detectionHealth"]);
    return data.detectionHealth || { modelState: health.modelState };
  },

  async pauseSiteRequest(msg) {
    await pauseSite(msg.domain, msg.ms);
    return { ok: true };
  },

  async resumeSiteRequest(msg) {
    await clearSitePause(msg.domain);
    return { ok: true };
  },
};

// ── Page review (replaces the screenshot appeal) ───────────────────────────────
//
// The plan called for navigating the tab back and screenshotting it. That renders
// possibly-explicit content to the user in order to decide whether they should be allowed
// to see it — self-defeating. We fetch the page server-side and classify its images
// instead; the user never sees it unless it clears. Parsing and verdict logic live in
// shared/review.js so they are testable without a browser.

async function reviewPage(pageUrl, profile) {
  try {
    const res = await fetch(pageUrl, { credentials: "omit" });
    if (!res.ok) return { verdict: "inconclusive", checked: 0, worst: 0 };

    const images = parseImageUrls(await res.text(), pageUrl);
    const predictions = [];
    for (const src of images) {
      predictions.push(await classifyImageUrl(src));
      // Short-circuit: one clearly unsafe image settles it, no need to fetch the rest.
      const running = reviewVerdict(predictions, profile);
      if (running.verdict === "unsafe") return running;
    }
    return reviewVerdict(predictions, profile);
  } catch (e) {
    console.error("reviewPage error:", e);
    return { verdict: "inconclusive", checked: 0, worst: 0 };
  }
}
