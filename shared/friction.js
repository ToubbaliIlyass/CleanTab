// Friction — the rule the whole product follows.
//
// CleanTab exists to put as much distance as it can between an urge and acting on it.
// So every way of getting LESS protection costs something, and the cost is never just a
// click: a wait, a phrase, a partner, or hours when it is simply unavailable. Getting
// MORE protection is always free and instant.
//
// A wrong block is the one case that must not become a dead end, and the answer to it is
// not "trust the person asking". The page is re-checked, text and pictures, on the
// device (shared/review.js). If it comes back clean it opens, at no cost. If it does not,
// opening it anyway is a pass-through: it waits, it counts against the day, and each one
// in a day waits twice as long as the last.

const PASS_WAIT_BASE_S = 30;
const PASS_WAIT_MAX_S = 5 * 60;
const LOOSEN_WAIT_S = 30;

// Seconds to wait before an unverified page can be opened anyway.
function passWaitSeconds(passesToday) {
  const n = Math.max(0, Number(passesToday) || 0);
  return Math.min(PASS_WAIT_BASE_S * Math.pow(2, n), PASS_WAIT_MAX_S);
}

// May this page be opened anyway, and what does it take?
//   listed    "adult" | "own" | null   on the built-in adult list / the user's blocklist
// Returns { available, why, needsPartner }.
function passPermission({ listed, settings, managed, exhausted }, now = Date.now()) {
  if (listed === "adult") {
    return { available: false, why: "This site is on the adult-site list. There is no way through it." };
  }
  if (listed === "own") {
    return { available: false, why: "You blocked this site yourself. It can be removed from the Sites tab." };
  }
  if (isWithinLockWindow(settings && settings.lockWindow, now)) {
    return {
      available: false,
      why: `These are your locked hours (${describeLockWindow(settings.lockWindow)}). Pages that don't check out clean stay closed until they end.`,
    };
  }
  if (exhausted) {
    return { available: false, why: "That's three times on this site today." };
  }
  return { available: true, why: "", needsPartner: Boolean(settings && settings.partnerLockHash) };
}

// Is changing sensitivity from one level to another a loosening?
const SENSITIVITY_ORDER = ["lenient", "balanced", "strict"];
function sensitivityLoosens(from, to) {
  return SENSITIVITY_ORDER.indexOf(to) < SENSITIVITY_ORDER.indexOf(from);
}
