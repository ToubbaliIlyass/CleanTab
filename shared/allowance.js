// "Let me through once" — how many times, and how often.
//
// The rule this product is built on: friction on turning CleanTab OFF is as high as it
// can be, friction on getting past ONE false positive stays near zero. Detection
// misfires, and a misfire that becomes unreachable content is what makes people
// distrust the tool and remove it wholesale.
//
// But the fourth pass-through on the same site in a day is not a false positive. It is
// a bypass, and the honest response to a page that really was wrong is "This site is
// fine" — which checks the site and grants lasting trust — not the same escape hatch
// over and over.
//
// So the first use stays free, and the count is per ROOT DOMAIN rather than per URL:
// scoping it to the exact URL would let one navigation to a sibling page reset it,
// which is no limit at all.
//
// The window is a day, and it resets with the ring. A bad day costs you nothing.

const ALLOWANCE_LIMIT_PER_DAY = 3;
const ALLOWANCE_WINDOW_MS = 24 * 60 * 60 * 1000;

function allowanceTimestamps(events, domain, now = Date.now()) {
  const cutoff = now - ALLOWANCE_WINDOW_MS;
  const list = (events && events[domain]) || [];
  return list.filter((ts) => typeof ts === "number" && ts > cutoff);
}

function allowanceUsed(events, domain, now = Date.now()) {
  return allowanceTimestamps(events, domain, now).length;
}

function allowanceRemaining(events, domain, now = Date.now()) {
  return Math.max(0, ALLOWANCE_LIMIT_PER_DAY - allowanceUsed(events, domain, now));
}

function allowanceExhausted(events, domain, now = Date.now()) {
  return allowanceRemaining(events, domain, now) === 0;
}

// Returns a new events map, with this domain's expired entries dropped so the record
// cannot grow without bound. Domains that fall out of the window entirely are removed.
function recordAllowanceUse(events, domain, now = Date.now()) {
  const next = {};
  for (const [key, list] of Object.entries(events || {})) {
    const kept = allowanceTimestamps({ [key]: list }, key, now);
    if (kept.length) next[key] = kept;
  }
  next[domain] = [...(next[domain] || []), now];
  return next;
}

// What the pause page should say about the escape hatch.
function allowanceMessage(remaining) {
  if (remaining <= 0) {
    return "You've used this three times on this site today. If the block is genuinely wrong, use “This site is fine” — it checks the site and remembers.";
  }
  if (remaining === 1) return "Once more on this site today.";
  return `${remaining} more on this site today.`;
}
