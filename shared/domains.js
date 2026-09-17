// Domain normalization — the single source of truth for how CleanTab identifies a site.
//
// This exists because the write side and the read side used to disagree: the appeal
// handler stored `hostname.replace("www.", "")` while the content script compared against
// a raw `location.hostname`. An approved appeal on any www host therefore never matched,
// and the user was redirected again immediately — an approval that looked successful and
// did nothing. Every comparison now goes through normalizeDomain().

function normalizeDomain(hostname) {
  if (!hostname) return "";
  // Anchored: only a LEADING "www." is stripped. The old unanchored replace()
  // would mangle hostnames that merely contained the substring.
  return String(hostname).toLowerCase().replace(/^www\./, "");
}

function domainFromUrl(url) {
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return "";
  }
}

// Trust entries are records as of schema v2: { domain, addedAt, source, expiresAt }.
// v1 stored bare strings, and a partially-migrated profile can hold either.
function trustEntryDomain(entry) {
  return typeof entry === "string" ? normalizeDomain(entry) : normalizeDomain(entry?.domain);
}

function isTrusted(trustedSites, hostname, now = Date.now()) {
  const target = normalizeDomain(hostname);
  if (!target) return false;
  return (trustedSites || []).some((entry) => {
    if (trustEntryDomain(entry) !== target) return false;
    const expiresAt = typeof entry === "string" ? null : entry?.expiresAt;
    return !expiresAt || expiresAt > now;
  });
}
