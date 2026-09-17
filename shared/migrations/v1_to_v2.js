// v1 → v2
//
// Adds: sensitivity, enableDwellDetection, blocks[], today.browsedMinutes.
// Converts: safeDomains (string[]) → trustedSites (record[]).
//
// Every v1 trust entry came from the appeal flow, and that flow was classifying CleanTab's
// own redirect page rather than the page it claimed to be judging — so it approved almost
// everything put to it. Those entries are preserved (deleting a user's settings without
// asking is worse), but tagged `source: "appeal-legacy"` so the Sites tab can flag them for
// review rather than presenting them as decisions the user meaningfully made.

function migrateV1ToV2(raw) {
  const out = { ...raw, schemaVersion: 2 };

  const legacy = Array.isArray(raw.safeDomains) ? raw.safeDomains : [];
  const existing = Array.isArray(raw.trustedSites) ? raw.trustedSites : [];
  const seen = new Set(existing.map((e) => normalizeDomain(e?.domain)));

  out.trustedSites = [...existing];
  for (const domain of legacy) {
    const norm = normalizeDomain(domain);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.trustedSites.push({
      domain: norm,
      addedAt: raw.__legacyTrustTs || null,
      source: "appeal-legacy",
      expiresAt: null,
    });
  }

  if (out.sensitivity === undefined) out.sensitivity = DEFAULT_SENSITIVITY;
  if (out.cleanShareGoal === undefined) out.cleanShareGoal = 0.95;
  if (out.enableDwellDetection === undefined) out.enableDwellDetection = false;
  if (!Array.isArray(out.blocks)) out.blocks = [];

  out.today = { ...(raw.today || {}) };
  if (typeof out.today.browsedMinutes !== "number") {
    // No historical basis to split these apart, so seed browsed = clean. The ratio reads
    // 100% for pre-v2 days, which is honest: we only ever counted unflagged minutes.
    out.today.browsedMinutes = out.today.cleanMinutes || 0;
  }

  return out;
}
