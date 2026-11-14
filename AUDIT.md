# CleanTab audit

Scope: manifest, service worker, content script, popup, onboarding, redirect, offscreen, shared/, tests, vendor, docs.
Status key: FIXED = changed in this pass; OPEN = left for a decision. Tests: `node tests/run.mjs` passes (477 checks).

## High

1. **FIXED - alarms starved by service-worker restarts.** `chrome.alarms.create()` ran unconditionally at top level. Re-creating a named alarm restarts its period, so a worker that wakes more often than the period (every page load messages it) could push `minuteTick`, `checkDisableTimer` and `dailyRollover` back indefinitely. Minutes stopped counting and timed pauses never ended. Now `ensureAlarm()` creates only missing alarms.
2. **FIXED - managed (policy) sensitivity ignored for image scanning and appeals.** `getTabPolicy` merged the admin value, but `classifyImage` and `appealRequest` read the user's own `sensitivity`. A locked "strict" policy still cleared images and appeals at the user's lenient threshold. Both now use `effectiveProfile()`.
3. **FIXED - backup import could undo the locks.** Importing a JSON file wrote `enabled`, `disableUntil`, `partnerLockHash`, `lockWindow`, `disableEvents` and `allowanceEvents`, which bypasses the passphrase, lock window and cooldown escalation. These keys are no longer importable.
4. **FIXED - privacy claims were inaccurate.** README and LANDING said "zero network requests" / "no external requests". The worker fetches images from visited sites (dwell scanning) and re-fetches the blocked page for the appeal review. Copy now says: no CleanTab server, requests only go to sites you are already visiting. LANDING line 104 already disclosed the appeal fetch.

## Medium

5. **FIXED - lost updates on read-modify-write.** `tickMinute`, `recordBlock`, `recordReflection`, `handleDailyRollover` and the session maps (`blockedByTab`, `tabVerdicts`, `tabs.onRemoved`) read, modified and wrote whole objects with no ordering, so concurrent events dropped one another's writes. Added `serialized()` queue in `shared/storage.js` (per context) plus a regression test. Cross-context races (popup writes vs. worker) remain; see OPEN 3.
6. **FIXED - no sender checks on messages.** Any extension context could call any handler. Added `SENDER_RULES`: content-script actions need a web tab, pause-screen actions (`allowOnce`, `appealRequest`, `getBlockContext`) need the redirect page, `nanoStatus`/`getHealth` need an extension page. Removed dead `pauseSiteRequest`/`resumeSiteRequest` handlers (popup writes session storage directly). `msg.src` must be http(s); redirect `reason` is length-capped. Static test enforces a rule per handler.
7. **FIXED - unbounded image fetch.** `classifyImageUrl` had no timeout or size cap; a huge image bloated worker memory and the base64 message to the offscreen doc. Now 15 s timeout, 8 MB cap. The content-script encode fallback downscales to 640 px.
8. **FIXED - Gemini Nano timeouts marked the NSFW model "unavailable".** `askOffscreen` updated detection health for every message type, so a slow Nano call showed the "Text only" badge. Health now tracks `classifyBlob` only.
9. **FIXED - badge arc not repainted after browser restart or rollover.** `setIcon` does not persist across restarts; repaint added on startup, install and daily rollover.
10. **FIXED - content script: disabling image scanning had no effect until reload; enabling it needed a reload too.** The dwell observer is now started when policy changes and re-checks `policy.dwellEnabled` before classifying. Uses `currentSrc` (srcset images) and guards a null `document.body`.
11. **FIXED - content script after extension reload/update.** The 1 s `setInterval` kept calling `chrome.runtime` on orphaned scripts (an exception per second, per tab). It now stops when `chrome.runtime.id` is gone, skips hidden tabs, and catches up on `visibilitychange`. `triggerRedirect` and the encode listener are null/throw safe.
12. **FIXED - web-accessible resources exposed install fingerprint.** `redirect.html` and `onboarding.html` were web-accessible to `<all_urls>`, letting any site detect CleanTab (and that the user runs a porn blocker). Nothing needs it: the worker navigates with `tabs.update`/`tabs.create`. Removed (test added).
13. **FIXED - manifest lacked `minimum_chrome_version`.** The worker uses `runtime.getContexts` (116), `offscreen`, `storage.session`. Set to 116.
14. **OPEN - `<all_urls>` host permission + `tabs`.** Required for cross-origin image fetch and the appeal review, but it is the main Web Store review risk and triggers the "read and change all data" warning. `tabs` is arguably redundant next to `<all_urls>` for `tab.url`, but I could not verify that querying the extension's own pages by URL still works without it, so it stays. Decide whether to drop the background fetches in favour of the content-script canvas path (CORS-limited) and use `activeTab`/optional host permission.

## Low

15. **FIXED - accessibility.** Popup had no `<title>`, tab bar was unlabelled buttons (now `role=tablist/tab`, `aria-selected` kept in sync), ring SVG had no text alternative, appeal result on the pause page is now `aria-live`. `popup.css` `.text-input` uses `outline:none` but supplies a border/box-shadow focus style (not checked visually).
16. **FIXED - doc accuracy.** `offscreen.html` comment claimed the bundle contains the model weights (it does not; `offscreen.js` loads them from `vendor/nsfwjs/model`). README "JavaScript / TypeScript" corrected. THIRD-PARTY-NOTICES now notes the unpinned NSFW.js version and inlined helper libraries.
17. **FIXED - `redirectTab` unhandled rejection** when the tab closes first.

## Reviewed, no change needed

- XSS: every `innerHTML` use in popup/onboarding interpolates constants or numbers only; user and page data go through `textContent`.
- No remote code. The vendored bundle contains the NSFW.js CloudFront default URL but `offscreen.js` always passes the local model (a static test enforces it). No `eval`/`new Function` in first-party code. Default MV3 CSP applies; no `content_security_policy` override.
- Listeners (`onMessage`, `onAlarm`, `onInstalled`, `onStartup`, `tabs.onRemoved`, `storage.onChanged`) are all registered synchronously at top level. Per-tab state is in `storage.session`, not worker memory. `nanoCache` and `health` are in-memory by design (health is republished to session).
- Managed schema passes the repo's Chrome-parser checks. Permissions `storage`, `alarms`, `idle`, `offscreen`, `tabs` are all used.
- Storage: history, blocks, reflections and allowance events are capped or pruned; local quota (10 MB) is not at risk.

## OPEN: left for your decision

1. **Iframes are not scanned** (`all_frames` unset). Embedded adult players/ads pass unnoticed; enabling it multiplies per-page cost and messages.
2. **`getEnvironmentScore` reads `innerText` on every `a, button, span...`** which forces layout per element on large pages; consider capping to the first N elements or using `textContent`. Changing it alters detection behaviour, so it needs your call and manual testing.
3. **Cross-context storage races**: the popup, onboarding and redirect pages write `today`/`totals`/etc. through the same helpers but from their own context, so `serialized()` cannot order them against the worker. Rare; a fix means routing all writes through the worker.
4. **Minutes count while Chrome is unfocused** (`idle` is system-wide). Checking `chrome.windows.getLastFocused().focused` would fix it but changes the metric.
5. **Offscreen document is never closed**; the TF.js model stays resident after one classification. Consider closing after an idle period.
6. **`incognito: "split"` with `offscreen`**: I could not verify offscreen availability in split incognito; test manually (MANUAL.md).
7. **Nano "contested block" path is dead**: `maybeAdjudicate` is only called with `wouldBlock: false`.
8. **Trust is exact-domain** (`example.com` does not cover `sub.example.com`). Likely intentional.
9. **Web Store policy**: justify `<all_urls>`, `offscreen` (reason `BLOBS` is a loose fit; `WORKERS`/`DOM_PARSER` are not better, so a precise justification matters), and the Gemini Nano feature in the listing's privacy disclosure. The onboarding "deploy" button opens `https://cleantab.acture.co/deploy` on user click only, which is fine, but list it. README "Future plans" still lists ML detection (shipped) and "privacy-safe analytics", which contradicts the no-analytics promise.
10. **`vendor/SETUP.md`** still says CleanTab "makes no network requests of its own" and fetches NSFW.js from an unpinned CDN URL; pin a version and a checksum.
11. **Import still accepts other settings** (`sensitivity`, `trustedSites`, `enableDwellDetection`) without type validation, and uses `alert()`.
12. Storage helpers ignore `chrome.runtime.lastError` (quota errors are silent).

## Restyle (playful theme)

- New `Assets/theme.css`, loaded after each page's stylesheet in popup, onboarding and pause page. It re-points colour/type tokens to the landing palette (warm ink on cream; coral, butter, sage, sky, peach, blush, lilac) and adds the chunky outline + offset-shadow treatment. Page CSS, IDs and logic are untouched.
- Fonts self-hosted in `Assets/fonts/` (Gabarito 500/700/900, Caveat Brush, DM Mono; woff2 copied from the landing project, declared in `fonts.css`). No remote fonts; no web-accessible resources added.
- Popup: plant next to the ring (`#plant`) grows sprout, leafy, bloom from the real clean share and ring-closed state (3 lines in `popup.js`). No new data, points or features. Heatmap squares and tabs restyled; text3 darkened for contrast.
- Pause page stays calm: same copy, soft backgrounds, handwritten note, aria-live status.
- Focus rings kept (coral 3px); `prefers-reduced-motion` disables all animation/transition.
- The content script injects no overlays or toasts, and there is no options page, so nothing else needed restyling.
- Checked by rendering the pages in Chromium with a chrome.* stub (screenshots not committed). Not tried in a real extension profile; check contrast of `.badge.off/.paused` class names against the real popup states.

## Product pass (see PRODUCT-AUDIT.md and WHAT-CHANGED.md)

New permission: `scripting` (inject into tabs open at install/update; host access was already `<all_urls>`). Content script now runs at `document_start`. New file `shared/protection.js` (pure, tested in `tests/protection.test.mjs`). New stored keys with defaults backfilled by `bootstrap()`: `blockedSites`, `pauseEvents`, `ifThenPlans`, `lastPopupOpen`; new `today` counters `passes`, `pauses`, `offs`, `leaves`, `celebrated`. Old history days are interpreted by `dayState()` without being rewritten. Import still excludes the lock keys; onboarding's "Restore a backup" does not apply that filter (fresh-install path), left as is.
