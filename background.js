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
  "shared/detect.js",
  "shared/nano.js",
  "shared/allowance.js",
  "shared/review.js",
  "shared/schema.js",
  "shared/lock.js",
  "shared/friction.js",
  "shared/protection.js",
  "shared/focus.js",
  "shared/focuspage.js",
  "shared/toolbar.js",
  "shared/migrations/v0_to_v1.js",
  "shared/migrations/v1_to_v2.js",
  "shared/storage.js",
);

// knownAdultDomains comes from shared/keywords.js — auto-denies appeals.

// ── Lifecycle ─────────────────────────────────────────────────────────────────

// Content scripts are only injected into pages that load AFTER the extension does, so on
// install or update every tab that was already open would be unprotected until reloaded —
// the first thing a new user tests. Inject into them. Needs the "scripting" permission;
// host access is already granted by <all_urls>. Pages that refuse injection (browser
// pages, the Web Store, PDFs) simply throw and are skipped.
async function injectIntoOpenTabs() {
  try {
    const files = chrome.runtime.getManifest().content_scripts?.[0]?.js || [];
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    for (const tab of tabs) {
      try {
        const [already] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => Boolean(globalThis.__cleantabLoaded),
        });
        if (already?.result) continue;
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
      } catch {
        // Not injectable. Fine.
      }
    }
  } catch {
    // Never let this break install.
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install" || details.reason === "update") injectIntoOpenTabs();
  bootstrap().then(() => {
    if (details.reason === "install") {
      chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") });
    }
    handleDailyRollover().then(() => refreshBadge());
    checkDisableTimer();
  });
});

chrome.runtime.onStartup.addListener(() => {
  bootstrap().then(() => {
    // setIcon does not survive a browser restart, so repaint the badge arc here.
    handleDailyRollover().then(() => refreshBadge());
    checkDisableTimer();
  });
});

// Granting incognito access reloads the extension, which can close the onboarding tab
// outright — on the very step that asks the user to go and grant it. The page saves a
// draft before sending them there; if it is gone when we come back, reopen it.
//
// This runs at top level, NOT from onInstalled or onStartup. An extension reload fires
// neither of those — onInstalled is install/update, onStartup is browser launch — so
// hanging it off them meant the tab never came back, which was the whole point. Every
// service worker start reaches this line, and the guards below make it cheap and
// idempotent.
async function resumeOnboardingIfInterrupted() {
  try {
    const data = await storageGet(["onboardingCompleted", "onboardingDraft"]);
    if (data.onboardingCompleted) return;
    // Only the interrupted case. Someone who simply closed the tab is left alone.
    if (!data.onboardingDraft?.resumePending) return;

    const url = chrome.runtime.getURL("onboarding/onboarding.html");
    const open = await chrome.tabs.query({ url });
    if (open.length) return;
    chrome.tabs.create({ url });
  } catch {
    // Never let this break startup.
  }
}

// This runs on every service worker start. chrome.alarms.create() with an existing name
// replaces that alarm and restarts its period, so creating unconditionally let a worker
// that kept waking up (every page load sends it a message) push the next tick back
// indefinitely. Only create what is missing.
async function ensureAlarm(name, periodInMinutes) {
  try {
    if (await chrome.alarms.get(name)) return;
    chrome.alarms.create(name, { periodInMinutes });
  } catch {
    // Never let alarm setup break startup.
  }
}

ensureAlarm("dailyRollover", 30);
ensureAlarm("minuteTick", 1);
ensureAlarm("checkDisableTimer", 1);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "dailyRollover") {
    handleDailyRollover().then(recalibrateGoal).then(() => refreshBadge());
  }
  if (alarm.name === "minuteTick") { tickMinuteForActiveTab(); tickFocus(); }
  if (alarm.name === "offscreenIdle") chrome.offscreen.closeDocument().catch(() => {});
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

// The classifier keeps a TensorFlow model and a GPU context alive. Close the document
// after a quiet spell; the next image recreates it. One-shot alarm, pushed back on use.
const OFFSCREEN_IDLE_MIN = 5;

async function ensureOffscreenDoc() {
  chrome.alarms.create("offscreenIdle", { delayInMinutes: OFFSCREEN_IDLE_MIN });
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
  // Only the image classifier feeds the "Text only" health badge. A slow or absent
  // Gemini Nano answer says nothing about whether NSFW.js works.
  const tracksHealth = message.action === "classifyBlob";
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (tracksHealth) {
        health.modelState = "unavailable";
        health.lastError = "Classifier timed out";
        publishHealth();
      }
      resolve(null);
    }, timeoutMs);

    chrome.runtime.sendMessage(message, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (chrome.runtime.lastError || !response?.ok) {
        if (tracksHealth) {
          health.modelState = "unavailable";
          health.lastError = chrome.runtime.lastError?.message || response?.error || "unknown";
          publishHealth();
        }
        resolve(null);
      } else {
        if (tracksHealth) {
          health.modelState = "ready";
          health.lastError = null;
          publishHealth();
        }
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

// Bounds what one image can cost: memory in the worker, and the size of the message
// carrying it (base64 inflates by a third) to the offscreen document.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT_MS = 15000;

function isHttpUrl(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

async function classifyImageUrl(src) {
  if (!isHttpUrl(src)) return null;
  try {
    const res = await fetch(src, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
    if (!res.ok) { health.fetchFailures += 1; publishHealth(); return null; }
    if (Number(res.headers.get("content-length")) > MAX_IMAGE_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 1024 || bytes.length > MAX_IMAGE_BYTES) return null; // pixels, spacers, huge files
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

// See predictionUnsafeScore() in shared/review.js: "sexy" counts at half weight.
function unsafeScore(prediction) {
  return predictionUnsafeScore(prediction);
}

// ── Gemini Nano adjudication ──────────────────────────────────────────────────
//
// Only reached for pages the rules are genuinely unsure about — see
// adjudicationAllowed() in shared/nano.js. Everything else is already decided, faster
// and deterministically, and a page that earned a block on strong evidence is never
// sent here at all, so no amount of text on it can argue its way out.

const nanoCache = new Map(); // url -> { verdict, at }
const NANO_CACHE_MS = 10 * 60 * 1000;
const NANO_CACHE_MAX = 200;

async function nanoEnabled() {
  const data = await storageGet(["enableNanoAssist"]);
  return data.enableNanoAssist === true;
}

async function getNanoAvailability() {
  try {
    await ensureOffscreenDoc();
    const res = await askOffscreen({ action: "nanoAvailability" }, 8000);
    return res?.state || "unavailable";
  } catch {
    return "unavailable";
  }
}

async function adjudicate(page) {
  const cached = nanoCache.get(page.url);
  if (cached && Date.now() - cached.at < NANO_CACHE_MS) return cached.verdict;

  await ensureOffscreenDoc();
  const res = await askOffscreen({ action: "nanoAdjudicate", page }, NANO_TIMEOUT_MS);
  const verdict = res?.ok ? res.verdict : null;

  if (nanoCache.size >= NANO_CACHE_MAX) {
    nanoCache.delete(nanoCache.keys().next().value);
  }
  nanoCache.set(page.url, { verdict, at: Date.now() });
  return verdict;
}

// The sensitivity profile that actually governs this install: an administrator's value
// wins over the user's, exactly as it does in getTabPolicy. Image and appeal thresholds
// used to read the user's own value and ignore policy.
async function effectiveProfile() {
  const stored = await storageGet(["sensitivity"]);
  const managed = await managedGet();
  return getProfile(effectiveSettings(stored, managed).sensitivity);
}

// ── Redirect ──────────────────────────────────────────────────────────────────
//
// The blocked URL is kept in session storage keyed by tab, not in the redirect page's
// query string. It used to land in the omnibox, in history and in session restore —
// for a tool whose whole point is NSFW content, that was the wrong default.

const BLOCKED_KEY = "blockedByTab";

function stashBlocked(tabId, url, reason, kind = "nsfw") {
  return serialized(async () => {
    const data = await sessionGet([BLOCKED_KEY]);
    const map = data[BLOCKED_KEY] || {};
    map[tabId] = { url, reason, kind, ts: Date.now() };
    await sessionSet({ [BLOCKED_KEY]: map });
  });
}

async function readBlocked(tabId) {
  const data = await sessionGet([BLOCKED_KEY]);
  return (data[BLOCKED_KEY] || {})[tabId] || null;
}

async function redirectTab(tabId, url, reason) {
  await stashBlocked(tabId, url, reason);
  await recordBlock(domainFromUrl(url), reason);
  // The tab can close between the verdict and here.
  chrome.tabs.update(tabId, { url: chrome.runtime.getURL("redirect/redirect.html") })
    .catch(() => {});
}

chrome.tabs.onRemoved.addListener((tabId) => serialized(async () => {
  const data = await sessionGet([BLOCKED_KEY, VERDICT_KEY]);
  const blocked = data[BLOCKED_KEY] || {};
  const verdicts = data[VERDICT_KEY] || {};
  delete blocked[tabId];
  delete verdicts[tabId];
  await sessionSet({ [BLOCKED_KEY]: blocked, [VERDICT_KEY]: verdicts });
}));

// ── Per-tab scan verdicts (plan §9 Phase 14) ──────────────────────────────────

const VERDICT_KEY = "tabVerdicts";

function setVerdict(tabId, verdict) {
  return serialized(async () => {
    const data = await sessionGet([VERDICT_KEY]);
    const map = data[VERDICT_KEY] || {};
    map[tabId] = { ...verdict, ts: Date.now() };
    await sessionSet({ [VERDICT_KEY]: map });
  });
}

async function getVerdict(tabId) {
  const data = await sessionGet([VERDICT_KEY]);
  return (data[VERDICT_KEY] || {})[tabId] || null;
}

// A verdict describes one URL. When the tab moves on, it is dropped, so a clean verdict
// from the last page can never be credited to a page that was not scanned (a browser
// page, the PDF viewer). The content script reports again once it has scanned the new one.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  serialized(async () => {
    const data = await sessionGet([VERDICT_KEY]);
    const map = data[VERDICT_KEY] || {};
    if (!(tabId in map)) return;
    delete map[tabId];
    await sessionSet({ [VERDICT_KEY]: map });
  });
});

// ── Minute tracking ───────────────────────────────────────────────────────────

// "Away" means no input for this long. A minute was too short: reading an article or
// watching a video without touching anything counted as being away, so the day's browsed
// minutes barely moved and most days stayed "quiet" instead of becoming protected.
const IDLE_AFTER_S = 5 * 60;

async function tickMinuteForActiveTab() {
  const data = await storageGet(["enabled", "disableUntil"]);
  if (data.enabled === false) return;
  if (data.disableUntil && data.disableUntil > Date.now()) return;

  const state = await new Promise((r) => chrome.idle.queryState(IDLE_AFTER_S, r));
  if (state !== "active") return;

  // Working in another app with Chrome in the background is not browsing.
  const win = await chrome.windows.getLastFocused().catch(() => null);
  if (!win?.focused) return;

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !tab.url || !tab.id) return;

  // The redirect page is not browsing.
  if (tab.url.startsWith(chrome.runtime.getURL("redirect/redirect.html"))) return;

  const verdict = await getVerdict(tab.id);
  // No verdict means we could not scan this tab — chrome://, the PDF viewer, the web
  // store. That is neutral, not virtuous: it advances neither counter. Counting it was
  // what made the old "clean minutes" number meaningless.
  //
  // There is no age limit on a verdict. It used to expire after two minutes, and a page is
  // only scanned when it loads, so every page stopped counting two minutes in: an hour on
  // one article was worth two browsed minutes. It is dropped when the tab's URL changes
  // instead (see onUpdated above).
  if (!verdict) return;

  const today = await tickMinute(verdict.clean);
  refreshBadge(today);
}

// ── Badge ─────────────────────────────────────────────────────────────────────

// The toolbar icon is the mascot's face with the popup mascot's mood (shared/toolbar.js);
// the tooltip carries the mood line and the protected-days count. The manifest's static
// PNGs are the neutral calm face.
//
// setIcon does not survive a browser restart, so this repaints on every worker start, but
// only when what is shown has changed, so the minute tick costs one storage read.
let lastIconKey = "";

async function refreshBadge(todayArg) {
  const data = await storageGet(["today", "history", "totals", "enabled", "disableUntil"]);
  if (todayArg) data.today = todayArg;
  const { mood, protectedCount, days } = moodFromData(data, todayLocal());

  const key = `${mood.level}:${protectedCount}`;
  if (key === lastIconKey) return;
  lastIconKey = key;

  try {
    await chrome.action.setIcon({ path: toolbarSpec(mood.level).path });
    await chrome.action.setTitle({
      title: `CleanTab: ${mood.caption} ${protectedCount} of the last ${days} days protected.`,
    });
  } catch {
    lastIconKey = ""; // try again next time
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.enabled || changes.disableUntil || changes.today || changes.history) refreshBadge();
  if (changes.focus || changes.focusSession || changes.focusSkipUntil) refreshFocusBadge();
});

// ── Focus mode ────────────────────────────────────────────────────────────────
//
// shared/focus.js decides; this is the stored state, the five-minute passes and the
// toolbar badge. The popup starts and ends sessions by writing storage directly, like
// every other setting, and the content scripts hear about it through storage.onChanged.

const FOCUS_KEYS = ["focus", "focusSession", "focusSkipUntil"];
const FOCUS_PASS_KEY = "focusPasses"; // session: { domain: until }

async function getFocusPass(domain) {
  const data = await sessionGet([FOCUS_PASS_KEY]);
  const until = (data[FOCUS_PASS_KEY] || {})[domain];
  return until && until > Date.now() ? until : null;
}

function grantFocusPass(domain) {
  return serialized(async () => {
    const data = await sessionGet([FOCUS_PASS_KEY]);
    const now = Date.now();
    const passes = {};
    for (const [d, until] of Object.entries(data[FOCUS_PASS_KEY] || {})) {
      if (until > now) passes[d] = until;
    }
    passes[domain] = now + FOCUS_PASS_MS;
    await sessionSet({ [FOCUS_PASS_KEY]: passes });
  });
}

// Pages recognised by what they do rather than by name (shared/focuspage.js), kept for
// the rest of this stretch of focus. Session storage: it is gone when the browser closes.
const FOCUS_SEEN_KEY = "focusSeen"; // session: [{ host, path, prefix, category, at }]

function rememberFocusPage(url, verdict, since) {
  return serialized(async () => {
    const data = await sessionGet([FOCUS_SEEN_KEY]);
    const kept = (data[FOCUS_SEEN_KEY] || []).filter((e) => e && e.at >= since).slice(-49);
    kept.push(focusRememberEntry(url, verdict));
    await sessionSet({ [FOCUS_SEEN_KEY]: kept });
  });
}

// A named site, or a streaming site recognised as one, is closed as a whole and is called
// by its name. A recognised feed is one part of a site, so only that part is mentioned.
function focusReason(url, recognisedFeed) {
  return recognisedFeed
    ? "This feed is closed while you focus."
    : `${domainFromUrl(url)} is closed while you focus.`;
}

// What focus says about one URL: { blocked, reason, until, nextChange, watch }.
// nextChange is when the answer could differ, so a page that is already open knows when
// to ask again (a schedule starting, a session or a pass ending) without polling the
// worker. watch is what the page should look for in itself when no list names it.
async function focusPolicyFor(url, stored) {
  const status = focusStatus(stored);
  const policy = {
    blocked: false, active: status.active, startedAt: status.startedAt,
    until: status.until, nextChange: status.nextChange, watch: null,
  };
  if (!status.active) return policy;

  let match = focusMatch(url, stored.focus);
  let recognisedFeed = false;
  if (!match) {
    const data = await sessionGet([FOCUS_SEEN_KEY]);
    const seen = focusRemembered(data[FOCUS_SEEN_KEY], url, status.startedAt);
    // Switching a category off (only possible between sessions) forgets what it caught.
    if (seen && focusSettings(stored.focus).categories[seen.category]) {
      match = seen;
      recognisedFeed = seen.category === "feeds";
    }
  }

  const passUntil = await getFocusPass(domainFromUrl(url));
  if (passUntil) {
    // Five minutes means five minutes: nothing is looked for while a pass runs.
    policy.nextChange = Math.min(passUntil, status.until);
    return policy;
  }
  if (!match) {
    policy.watch = focusWatchFor(url, stored.focus);
    return policy;
  }
  policy.blocked = true;
  policy.reason = focusReason(url, recognisedFeed);
  return policy;
}

// Minutes left, on the toolbar icon, so a session is visible without opening anything.
async function refreshFocusBadge() {
  try {
    const status = focusStatus(await storageGet(FOCUS_KEYS));
    if (!status.active) {
      await chrome.action.setBadgeText({ text: "" });
      return;
    }
    await chrome.action.setBadgeBackgroundColor({ color: "#FF6B35" });
    await chrome.action.setBadgeTextColor?.({ color: "#FFFFFF" });
    await chrome.action.setBadgeText({ text: focusBadgeText(status.until - Date.now()) });
  } catch {
    // The badge is decoration; never let it break a tick.
  }
}

// Once a minute while focus is on. Focus time is wall-clock time with the screen
// unlocked: working in another app is the whole point, so unlike browsed minutes this
// does not ask whether Chrome is in front.
async function tickFocus() {
  const stored = await storageGet([...FOCUS_KEYS, "enabled", "disableUntil"]);
  const status = focusStatus(stored);
  if (status.active) {
    // A scheduled window can open while protection is paused. Focus ends the pause.
    if (stored.enabled === false || stored.disableUntil) {
      await storageRemove("disableUntil");
      await storageSet({ enabled: true });
    }
    const state = await new Promise((r) => chrome.idle.queryState(IDLE_AFTER_S, r));
    if (state !== "locked") await recordDayEvent("focusMinutes");
  }
  refreshFocusBadge();
}

// ── Message router ────────────────────────────────────────────────────────────
//
// Every handler is reachable only from the context it was written for. Nothing outside the
// extension can message the worker (no externally_connectable), but a content script runs
// beside page code, so it must not be able to call the pause screen's or popup's actions.
const EXTENSION_URL = chrome.runtime.getURL("");
const REDIRECT_URL = chrome.runtime.getURL("redirect/redirect.html");

const fromContentScript = (sender) =>
  Boolean(sender.tab) && !String(sender.url || "").startsWith(EXTENSION_URL);
const fromRedirectPage = (sender) => String(sender.url || "").startsWith(REDIRECT_URL);
const fromExtensionPage = (sender) => String(sender.url || "").startsWith(EXTENSION_URL);

const SENDER_RULES = {
  getTabPolicy: fromContentScript,
  tabVerdict: fromContentScript,
  redirect: fromContentScript,
  focusDetected: fromContentScript,
  classifyImage: fromContentScript,
  nanoAdjudicate: fromContentScript,
  getBlockContext: fromRedirectPage,
  leavePause: fromRedirectPage,
  checkPage: fromRedirectPage,
  allowOnce: fromRedirectPage,
  appealRequest: fromRedirectPage,
  nanoStatus: fromExtensionPage,
  getHealth: fromExtensionPage,
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = HANDLERS[msg?.action];
  if (!handler) return false;
  if (sender.id !== chrome.runtime.id || !SENDER_RULES[msg.action]?.(sender)) {
    sendResponse({ error: "Not permitted from this context." });
    return false;
  }
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
    // One round trip per page load wakes the worker, so the reads run together.
    const [stored, managed, sitePausedUntil, allowed] = await Promise.all([
      storageGet([
        "enabled", "disableUntil", "trustedSites", "sensitivity", "enableDwellDetection",
        "blockedSites", ...FOCUS_KEYS,
      ]),
      managedGet(),
      getSitePause(domain),
      hasAllowance(url),
    ]);
    // An administrator's sensitivity and image-scanning values win over the user's.
    // Merging here rather than in the popup is what makes the policy actually govern
    // detection instead of only greying out a control.
    const data = effectiveSettings(stored, managed);

    let globallyOff = data.enabled === false ||
      Boolean(data.disableUntil && data.disableUntil > Date.now());
    // Focus is an extra layer: protection is always on underneath it. tickFocus() also
    // writes that back to storage; this covers the minute before it does.
    if (focusStatus(stored).active) globallyOff = false;
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
      // Lists the content script can act on before the page has even loaded. The user's
      // own blocklist beats the trust list; the built-in adult-site list does not.
      userBlocked: isUserBlocked(data.blockedSites, domain),
      // The adult-site list is not something a click can switch off: only an
      // administrator's trust entry exempts a domain from it.
      knownAdult: isKnownAdultDomain(domain) &&
        !isTrusted((managed.lockedTrustedSites || []).map((d) => makeTrustEntry(d, "managed")), domain),
      sitePausedUntil,
      allowed,
      profile,
      dwellEnabled: Boolean(data.enableDwellDetection) && profile.dwell,
      // Independent of everything above: focus applies with protection off, and to
      // trusted sites.
      focus: await focusPolicyFor(url, stored),
    };
  },

  async tabVerdict(msg, sender) {
    if (!sender.tab?.id) return { ok: false };
    await setVerdict(sender.tab.id, { clean: Boolean(msg.clean), score: msg.score || 0 });
    return { ok: true };
  },

  async redirect(msg, sender) {
    if (!sender.tab?.id || !sender.tab.url) return { ok: false };
    if (msg.kind === "focus") {
      // Decided again here rather than taken on the page's word, and kept out of the
      // block log and the day's pause count: a focus block is not a slip.
      const focus = await focusPolicyFor(sender.tab.url, await storageGet(FOCUS_KEYS));
      if (!focus.blocked) return { ok: false };
      await stashBlocked(sender.tab.id, sender.tab.url, focus.reason, "focus");
      await recordDayEvent("focusBlocks");
      chrome.tabs.update(sender.tab.id, { url: chrome.runtime.getURL("redirect/redirect.html") })
        .catch(() => {});
      return { ok: true };
    }
    const reason = String(msg.reason || "").slice(0, 200) || "This page was flagged.";
    await redirectTab(sender.tab.id, sender.tab.url, reason);
    return { ok: true };
  },

  // The page recognised itself as streaming or as an endless feed (shared/focuspage.js).
  // The signals are the page's word, so the decision is made again here from them, and
  // only for a URL that focus was actually watching. Like every focus block, it is not a
  // slip: no block log, no pause count.
  async focusDetected(msg, sender) {
    if (!sender.tab?.id || !sender.tab.url || sender.frameId) return { ok: false };
    const url = sender.tab.url;
    const focus = await focusPolicyFor(url, await storageGet(FOCUS_KEYS));
    if (!focus.active || focus.blocked || !focus.watch) return { ok: false };
    const verdict = focusPageVerdict(msg.signals, focus.watch);
    if (!verdict) return { ok: false };
    await rememberFocusPage(url, verdict, focus.startedAt || 0);
    await stashBlocked(sender.tab.id, url, focusReason(url, verdict.category === "feeds"), "focus");
    await recordDayEvent("focusBlocks");
    chrome.tabs.update(sender.tab.id, { url: chrome.runtime.getURL("redirect/redirect.html") })
      .catch(() => {});
    return { ok: true };
  },

  async classifyImage(msg, sender) {
    if (!isHttpUrl(msg.src)) return { unsafe: false, inconclusive: true };
    const profile = await effectiveProfile();
    let prediction = await classifyImageUrl(msg.src);
    if (!prediction && sender.tab?.id) {
      prediction = await classifyViaContentScript(sender.tab.id, msg.src);
    }
    if (!prediction) return { unsafe: false, inconclusive: true };
    const score = unsafeScore(prediction);
    return { unsafe: score > profile.unsafeProb, score };
  },

  // What the redirect page needs. The URL never travelled through the query string.
  async getBlockContext(msg, sender) {
    const tabId = sender.tab?.id;
    const blocked = tabId ? await readBlocked(tabId) : null;
    if (!blocked) return { reason: "This page was flagged.", domain: "", canAppeal: false };
    if (blocked.kind === "focus") {
      const domain = domainFromUrl(blocked.url);
      const focus = await focusPolicyFor(blocked.url, await storageGet(FOCUS_KEYS));
      const allowance = await allowanceStateFor(`focus:${domain}`);
      return {
        kind: "focus",
        reason: blocked.reason,
        domain,
        canAppeal: false,
        // False once the session has ended (or a pass was granted in another tab): the
        // page then offers the way back instead of a countdown.
        stillBlocked: focus.blocked,
        until: focus.until,
        allowanceRemaining: allowance.remaining,
      };
    }
    const managed = await managedGet();
    const domain = domainFromUrl(blocked.url);
    const stored = await storageGet(["blockedSites", "partnerLockHash", "lockWindow", "today"]);
    const allowance = await allowanceStateFor(domain);
    const listed = isUserBlocked(stored.blockedSites, domain) ? "own"
      : knownAdultDomains.has(domain) ? "adult" : null;
    return {
      reason: blocked.reason,
      domain,
      // On a list: there is nothing to check and no way through from here.
      listed,
      listedNote: listed ? passPermission({ listed }).why : "",
      allowanceRemaining: allowance.remaining,
      canAppeal: !listed && managed.allowAppeals !== false,
    };
  },

  // "Let me through once" — 10 minutes, this URL only, session-scoped. Capped at three
  // uses per root domain per day: the first is a false positive, the fourth is a bypass.
  async allowOnce(msg, sender) {
    const tabId = sender.tab?.id;
    const blocked = tabId ? await readBlocked(tabId) : null;
    if (!blocked) return { ok: false };

    const domain = domainFromUrl(blocked.url);

    // Focus: five minutes on this site, three times a day. Never a "pass" in the
    // protected-days sense. If focus has ended meanwhile, this is simply the way back.
    if (blocked.kind === "focus") {
      const focus = await focusPolicyFor(blocked.url, await storageGet(FOCUS_KEYS));
      if (focus.blocked) {
        const key = `focus:${domain}`;
        const left = await allowanceStateFor(key);
        if (left.exhausted) {
          return {
            ok: false,
            exhausted: true,
            reason: "That's three times on this site today. It will be here when you're done.",
          };
        }
        await recordAllowance(key);
        await grantFocusPass(domain);
      }
      chrome.tabs.update(tabId, { url: blocked.url });
      return { ok: true };
    }

    // Opening a page that did NOT check out clean. Everything that makes this cost
    // something is enforced here, not just drawn on the pause page: the page must have
    // been checked, the wait must have run, and the lock applies.
    const ready = await readPassReady(tabId);
    if (!ready || ready.url !== blocked.url) return { ok: false, reason: "Check the page first." };
    if (Date.now() < ready.at) return { ok: false, reason: "The wait isn't over yet." };

    const permission = await passPermissionFor(domain);
    if (!permission.available) return { ok: false, exhausted: true, reason: permission.why };
    if (permission.needsPartner) {
      const { partnerLockHash } = await storageGet(["partnerLockHash"]);
      if (!(await partnerPassphraseMatches(msg.passphrase, partnerLockHash))) {
        return { ok: false, partner: true, reason: "That isn't the passphrase." };
      }
    }

    await clearPassReady(tabId);
    await recordAllowance(domain);
    await recordDayEvent("passes");
    await grantAllowance(blocked.url);
    chrome.tabs.update(tabId, { url: blocked.url });
    return { ok: true };
  },

  // "Check this page": the answer to a wrong block. The page's text and pictures are
  // re-read on the device. Clean opens it, free, and the day stays protected. Anything
  // else leaves it closed and says what opening it anyway would take.
  async checkPage(msg, sender) {
    const tabId = sender.tab?.id;
    const blocked = tabId ? await readBlocked(tabId) : null;
    if (!blocked || blocked.kind === "focus") return { status: "lost", reason: "The original page was lost." };

    const domain = domainFromUrl(blocked.url);
    const permission = await passPermissionFor(domain);
    if (permission.listed) return { status: "listed", reason: permission.why };

    const result = await reviewPageFull(blocked.url);
    if (result.verdict === "clean") {
      await grantAllowance(blocked.url);
      chrome.tabs.update(tabId, { url: blocked.url });
      return { status: "clean", reason: result.reason };
    }

    const { today } = await storageGet(["today"]);
    const waitSeconds = passWaitSeconds((today || {}).passes);
    if (permission.available) await setPassReady(tabId, blocked.url, Date.now() + waitSeconds * 1000);
    return {
      status: result.verdict, // "flagged" | "unclear"
      reason: result.reason,
      anyway: {
        available: permission.available,
        why: permission.why,
        needsPartner: Boolean(permission.needsPartner),
        waitSeconds,
      },
    };
  },

  // "Leave" on the pause screen: counted (it is the outcome worth celebrating) and the
  // tab goes to a new tab page. Nothing is stored about where it was.
  async leavePause(msg, sender) {
    const tabId = sender.tab?.id;
    if (!tabId) return { ok: false };
    // "leaves" is the count of adult-content pauses you walked away from.
    const blocked = await readBlocked(tabId);
    if (blocked?.kind !== "focus") await recordDayEvent("leaves");
    chrome.tabs.update(tabId, { url: "chrome://newtab/" }).catch(() => {});
    return { ok: true };
  },

  async appealRequest(msg, sender) {
    const tabId = sender.tab?.id;
    const blocked = tabId ? await readBlocked(tabId) : null;
    if (!blocked) return { status: "denied", reason: "Nothing to review — the original page was lost." };

    const domain = domainFromUrl(blocked.url);
    const { blockedSites } = await storageGet(["blockedSites"]);
    if (isUserBlocked(blockedSites, domain)) {
      return {
        status: "denied",
        permanent: true,
        reason: "You blocked this site yourself. Remove it from the Sites tab if that has changed.",
      };
    }
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

    const result = await reviewPageFull(blocked.url);

    if (result.verdict === "clean") {
      await addTrustedSite(domain, "appeal");
      chrome.tabs.update(tabId, { url: blocked.url });
      return { status: "approved", reason: result.reason };
    }
    return { status: result.verdict === "flagged" ? "denied" : "inconclusive", reason: result.reason };
  },

  // The content script asks for a second opinion, and only when the rules were unsure.
  async nanoAdjudicate(msg) {
    if (!(await nanoEnabled())) return { verdict: null, reason: "off" };
    if (!adjudicationAllowed(msg.context)) return { verdict: null, reason: "not-ambiguous" };
    try {
      const verdict = await adjudicate(msg.page);
      return { verdict };
    } catch (err) {
      // Never let the model's absence or slowness change a page's fate.
      return { verdict: null, reason: String(err?.message || err) };
    }
  },

  async nanoStatus() {
    const [availability, enabled] = await Promise.all([
      getNanoAvailability(),
      nanoEnabled(),
    ]);
    return { availability, enabled };
  },

  async getHealth() {
    const data = await sessionGet(["detectionHealth"]);
    return data.detectionHealth || { modelState: health.modelState };
  },

};

// ── Page review ───────────────────────────────────────────────────────────────
//
// The page is fetched and judged without being shown: rendering possibly-explicit content
// to decide whether someone may see it would defeat the point.

// The whole-page check behind "Check this page" and "This site is fine": the fetched
// page's words through the blocking rules at the strictest profile, and its pictures
// through the classifier. See fullReviewVerdict() in shared/review.js.
async function reviewPageFull(pageUrl) {
  const profile = await effectiveProfile();
  let html = "";
  try {
    const res = await fetch(pageUrl, { credentials: "omit", signal: AbortSignal.timeout(15000) });
    if (res.ok) html = await res.text();
  } catch {
    // Unreadable is "unclear", never "clean".
  }
  if (!html) return fullReviewVerdict(null, 0, { verdict: "inconclusive", checked: 0, worst: 0 });

  const page = pageFromHtml(html, pageUrl);
  const textDecision = decidePage(page, getProfile("strict"));
  // No point classifying pictures on a page the words already settled.
  if (textDecision.block) return fullReviewVerdict(textDecision, page.bodyText.length, { verdict: "inconclusive", checked: 0 });

  const predictions = [];
  let images = { verdict: "inconclusive", checked: 0, worst: 0 };
  for (const src of parseImageUrls(html, pageUrl)) {
    predictions.push(await classifyImageUrl(src));
    images = reviewVerdict(predictions, profile);
    if (images.verdict === "unsafe") break;
  }
  return fullReviewVerdict(textDecision, page.bodyText.length, images);
}

// When an unverified page may be opened anyway: set by checkPage, read by allowOnce.
const PASS_READY_KEY = "passReady"; // session: { tabId: { url, at } }

function setPassReady(tabId, url, at) {
  return serialized(async () => {
    const data = await sessionGet([PASS_READY_KEY]);
    const map = data[PASS_READY_KEY] || {};
    // Checking again must not shorten a wait that is already running.
    const existing = map[tabId];
    map[tabId] = existing && existing.url === url ? existing : { url, at };
    await sessionSet({ [PASS_READY_KEY]: map });
  });
}

async function readPassReady(tabId) {
  const data = await sessionGet([PASS_READY_KEY]);
  return (data[PASS_READY_KEY] || {})[tabId] || null;
}

function clearPassReady(tabId) {
  return serialized(async () => {
    const data = await sessionGet([PASS_READY_KEY]);
    const map = data[PASS_READY_KEY] || {};
    delete map[tabId];
    await sessionSet({ [PASS_READY_KEY]: map });
  });
}

async function passPermissionFor(domain) {
  const stored = await storageGet(["blockedSites", "partnerLockHash", "lockWindow"]);
  const listed = isUserBlocked(stored.blockedSites, domain) ? "own"
    : knownAdultDomains.has(domain) ? "adult" : null;
  const allowance = await allowanceStateFor(domain);
  return {
    listed,
    ...passPermission({ listed, settings: stored, managed: await managedGet(), exhausted: allowance.exhausted }),
  };
}

// Runs on every service worker start, including the one caused by an extension reload.
resumeOnboardingIfInterrupted();

// Repaint the toolbar icon on every worker start (setIcon does not persist a restart).
refreshBadge();
refreshFocusBadge();
