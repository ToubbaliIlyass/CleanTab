// Lock strength — everything that governs how hard CleanTab is to switch off.
//
// The design rule this file exists to enforce: friction on *turning the tool off* should
// be as high as it can be, while friction on *getting past one false positive* stays
// low. Those are different doors. "Let me through once" is deliberately cheap; the paths
// in here are deliberately expensive. Hard-lock blockers die when a misfire on a health
// article becomes unreachable content, so nothing here touches the per-page escape.
//
// Nothing in this file is security. A determined user with devtools open defeats any
// client-side lock, and the only true uninstall protection is an OS-level admin policy
// (ExtensionInstallForcelist). This is friction aimed at impulse, plus an honest
// mechanism for handing the key to someone else.

// ── Partner-held passphrase ───────────────────────────────────────────────────
//
// A second person sets a phrase at setup and keeps it. CleanTab stores only a SHA-256
// hash, locally. No server, no email, no stored contact details — the social cost is
// what makes this work, and it does not require a backend to produce it.

const PARTNER_MIN_LENGTH = 8;

// Typed recall by a human, not a credential: case and spacing should not decide it.
function normalizePassphrase(text) {
  return String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function hashPassphrase(text) {
  const normalized = normalizePassphrase(text);
  if (!normalized) return null;
  const bytes = new TextEncoder().encode(`cleantab:v1:${normalized}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isValidPartnerPassphrase(text) {
  return normalizePassphrase(text).length >= PARTNER_MIN_LENGTH;
}

async function partnerPassphraseMatches(text, storedHash) {
  if (!storedHash) return false;
  const candidate = await hashPassphrase(text);
  return Boolean(candidate) && candidate === storedHash;
}

// ── Escalating cooldown ───────────────────────────────────────────────────────
//
// A flat one-hour wait treats the first disable of the month and the fourth of the day
// identically. Repeat impulse is the actual failure mode, so each disable inside the
// window doubles the next wait.

const COOLDOWN_BASE_MS = 60 * 60 * 1000;      // 1 hour
const COOLDOWN_MAX_MS = 24 * 60 * 60 * 1000;  // 24 hours
const ESCALATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function recentDisableCount(disableEvents, now = Date.now()) {
  const cutoff = now - ESCALATION_WINDOW_MS;
  return (disableEvents || []).filter((ts) => typeof ts === "number" && ts > cutoff).length;
}

function computeCooldownMs(disableEvents, now = Date.now()) {
  const recent = recentDisableCount(disableEvents, now);
  return Math.min(COOLDOWN_BASE_MS * Math.pow(2, recent), COOLDOWN_MAX_MS);
}

// Kept trimmed to the escalation window so the list cannot grow without bound.
function recordDisableEvent(disableEvents, now = Date.now()) {
  const cutoff = now - ESCALATION_WINDOW_MS;
  return [...(disableEvents || []).filter((ts) => typeof ts === "number" && ts > cutoff), now];
}

function describeCooldown(ms) {
  const hours = ms / (60 * 60 * 1000);
  if (hours < 1) return `${Math.round(ms / 60000)}-minute`;
  if (Number.isInteger(hours)) return `${hours}-hour`;
  return `${hours.toFixed(1)}-hour`;
}

// ── Lock window ───────────────────────────────────────────────────────────────
//
// The off switch simply does not exist during hours the user nominated in advance —
// late night, typically. Choosing this while calm is the point; it is a Ulysses
// contract, not a restriction imposed from outside.

function isWithinLockWindow(lockWindow, now = Date.now()) {
  if (!lockWindow?.enabled) return false;
  const start = Number(lockWindow.startHour);
  const end = Number(lockWindow.endHour);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return false;

  const hour = new Date(now).getHours();
  // A window like 22 → 6 wraps past midnight, so the comparison has to invert.
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

function formatHour(hour) {
  const h = ((Number(hour) % 24) + 24) % 24;
  const suffix = h < 12 ? "am" : "pm";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${suffix}`;
}

function describeLockWindow(lockWindow) {
  if (!lockWindow?.enabled) return "";
  return `${formatHour(lockWindow.startHour)}–${formatHour(lockWindow.endHour)}`;
}

// ── Managed settings (chrome.storage.managed) ─────────────────────────────────
//
// An administrator's values are authoritative and read-only. Presenting a control that
// silently refuses to change is worse than presenting a locked one, so the UI asks
// isSettingManaged() and says who set it.

const MANAGEABLE_KEYS = [
  "sensitivity",
  "enableDwellDetection",
  "allowDisable",
  "allowAppeals",
  "allowTrustSites",
  "lockedTrustedSites",
];

function isSettingManaged(managed, key) {
  return Boolean(managed) && Object.prototype.hasOwnProperty.call(managed, key);
}

// Managed values win over local ones. Anything the administrator left unset stays the
// user's own choice, which is what makes one build serve both install paths.
function effectiveSettings(local, managed) {
  const merged = { ...(local || {}) };
  for (const key of MANAGEABLE_KEYS) {
    if (isSettingManaged(managed, key)) merged[key] = managed[key];
  }
  return merged;
}

// One place to ask "may the user turn this off right now, and if not, why not".
function disablePermission(settings, managed, now = Date.now()) {
  if (isSettingManaged(managed, "allowDisable") && managed.allowDisable === false) {
    return { allowed: false, reason: "managed", detail: "Your administrator has locked this setting." };
  }
  if (isWithinLockWindow(settings?.lockWindow, now)) {
    return {
      allowed: false,
      reason: "window",
      detail: `You set a lock window for ${describeLockWindow(settings.lockWindow)}. The off switch is unavailable until it ends.`,
    };
  }
  if (settings?.partnerLockHash) {
    return {
      allowed: true,
      reason: "partner",
      detail: settings.partnerLockLabel
        ? `${settings.partnerLockLabel} holds the passphrase.`
        : "Your accountability partner holds the passphrase.",
    };
  }
  return { allowed: true, reason: "self" };
}
