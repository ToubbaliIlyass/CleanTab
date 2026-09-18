# CleanTab — Redesign & Enhancement Plan

This plan converts the current MVP into the design we landed on: real screenshot-based detection, a ring-based daily metric, cumulative lifetime progress, structured reflection prompts in place of guilt UI, and adaptive goal calibration. Everything stays local-first.

---

## 1. Guiding principles

1. **Privacy stays absolute.** All data lives in `chrome.storage.local`. No servers, no analytics, no telemetry. Sync is a future opt-in feature, not part of v1.
2. **No streak metaphor anywhere.** No "current streak" number, no "longest run" overlay, no "you broke X" copy. Loss-aversion framing is what we're removing.
3. **One daily metric, one lifetime metric.** Today's ring is the focal point. Cumulative totals only grow. The user should never look at a number that can only decrease.
4. **Honesty over theater.** The word "AI" only appears next to actual model output. Confidence numbers come from a real classifier or they don't exist.
5. **Friction is the feature.** Disabling, appealing, and reflecting should each take a real moment — short enough to do, long enough to mean something.

---

## 2. Storage architecture

### 2.1 Decision
- Single source of truth: `chrome.storage.local`.
- All read/write goes through a centralized module (`shared/storage.js`) so the schema, defaults, and migrations live in one place.
- Manual export / import as the user's backup story (downloads / uploads a JSON blob).

### 2.2 Schema (v1)

```jsonc
{
  "schemaVersion": 1,

  // Settings
  "enabled": true,
  "disableUntil": null,
  "cooldownUntil": null,
  "safeDomains": [],
  "onboardingCompleted": false,
  "selfEstimateHours": null,    // chosen in onboarding: 1.5, 3.5, 5.5, 7.5, 9
  "goalMinutes": null,          // current daily ring goal, computed
  "passphraseAttempts": 0,      // optional, for future tuning

  // Today's working counters (reset on date rollover)
  "today": {
    "date": "2026-05-18",        // YYYY-MM-DD, user's local tz
    "cleanMinutes": 0,
    "redirects": 0,
    "reflections": 0,
    "ringClosedAt": null         // timestamp when ring first closed today
  },

  // Daily history (rolling, capped at 365 days)
  "history": {
    "2026-05-17": { "cleanMinutes": 142, "goalMinutes": 180, "redirects": 2, "reflections": 1, "ringClosed": false },
    "2026-05-16": { "cleanMinutes": 195, "goalMinutes": 180, "redirects": 0, "reflections": 0, "ringClosed": true }
    // ...
  },

  // Cumulative totals (monotonic — only grow)
  "totals": {
    "closedDays": 0,
    "reflectionsLogged": 0,
    "lifetimeCleanMinutes": 0
  },

  // Reflection log (most sensitive — never leaves device)
  "reflections": [
    { "ts": 1715000000000, "chip": "stressed", "domain": "example.com" }
    // ...
  ]
}
```

### 2.3 Storage rules

- **Date rollover**: detected via `chrome.alarms` running every 30 min, plus on `onStartup` / `onInstalled`. On rollover, `today` is flushed into `history[yesterday]`, `today` resets, and `totals` are updated (specifically `closedDays` if yesterday's ring closed).
- **Time zone**: all date keys use the user's local timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`). Replace the current `toISOString().slice(0,10)` UTC-based key everywhere.
- **History cap**: keep last 365 days. Older entries are dropped on rollover. `totals` already captures everything older as a single aggregate.
- **Reflection log cap**: keep last 1000 entries. Older entries are dropped but `totals.reflectionsLogged` retains the count.
- **Write batching**: the minute-by-minute clean-browsing counter writes once per minute, not per second, to stay well below quota churn.
- **Schema versioning**: `schemaVersion` checked on extension startup. If lower than current, run migrations in order (`migrations/v1_to_v2.js`, etc.).

### 2.4 Export / Import

- Export button in popup → downloads `cleantab-backup-YYYY-MM-DD.json` containing the full storage snapshot.
- Import button → file picker → validates `schemaVersion`, runs migrations if needed, merges or replaces (user is asked).

---

## 3. Implementation phases

Phases are ordered so each one ships a usable improvement on its own. You can stop after any phase and the extension still works.

---

### Phase 1 — Critical detection fixes (small, high impact)

Fixes the immediate false-positive class (Google login, etc.) without touching architecture.

**Changes**
- `content.js` and `background.js`: replace every `lower.includes(keyword)` with a precompiled word-boundary regex (`new RegExp(\`\\\\b${keyword}\\\\b\`, 'i')`). Build the regex set once at module load, not per scan.
- `content.js` `getURLScore`: before scoring search params, skip params named `continue`, `redirect_uri`, `redirect`, `next`, `return_to`, `returnTo`, `state`, `url`, `dest`, `destination` — these carry passthrough URLs that aren't user intent.
- `manifest.json`: remove `tabCapture` from `permissions` (unused; we'll use `tabs.captureVisibleTab` which is already covered by `tabs` permission).
- `content.js`: delete the unreachable YouTube-specific branch at the second `urlScore >= 5` check.
- `content.js`: delete the empty `if (riskyEnvironment && !inside) { /* ... */ }` block.
- `content.js`: delete the unused `adultAnchors` Set (kept `adultAnchorWords` is the live one).

**Acceptance**
- Google sign-in pages with `?continue=...` in the URL no longer trigger redirects.
- Pages containing `Essex`, `camera`, `denude`, `unisex`, `Cambridge`, `webcamera` no longer accumulate scores.
- All existing positive detections still trigger.

---

### Phase 2 — Storage layer + schema migration

Introduces the centralized storage module, schema versioning, and timezone fix. Pure refactor — no user-visible change.

**Changes**
- New `shared/storage.js` exporting `get`, `set`, `update`, `getToday`, `incrementCleanMinute`, `recordRedirect`, `recordReflection`, etc.
- New `shared/schema.js` with the schema defaults and `migrate(currentVersion)` function.
- New `shared/dates.js` with `todayLocal()` and `daysBetween(a, b)` using user's local timezone.
- `background.js`, `content.js`, `popup/popup.js`, `redirect/redirect.js` all migrate off direct `chrome.storage.local` calls and through the new module.
- On `onInstalled` and `onStartup`: read `schemaVersion`, run any needed migrations, then call `migrateLegacyState()` to convert the existing v0 keys (`streak`, `lastStreakDay`, etc.) into the new schema.

**Acceptance**
- Existing users who update the extension don't lose their data — their old `streak` and `redirectsToday` get folded into `history` and `totals`.
- All storage access goes through one module.
- Rollover happens at local midnight, not UTC midnight.

---

### Phase 3 — Onboarding tab + adaptive goal

Adds the install-tab experience and the calibration mechanic.

**Changes**
- `manifest.json`: add `chrome.runtime.onInstalled` handler that opens `onboarding/onboarding.html` on `reason === "install"`.
- New `onboarding/onboarding.html`, `onboarding.css`, `onboarding.js`: single-screen layout from the locked design (explainer + privacy line + 5 calibration chips + Done button).
- On submit: write `selfEstimateHours`, compute initial `goalMinutes = Math.round(selfEstimateHours * 60 * 0.7)`, clamp to `[60, 240]`, set `onboardingCompleted: true`.
- New `shared/goal.js`:
  - `computeInitialGoal(selfEstimateHours)` — `0.7 * estimate`, clamped.
  - `recalibrateGoal(historyLastNDays)` — median of last 30 days × 0.7, blended toward current goal by 20%.
- Background: monthly alarm runs `recalibrateGoal`.

**Acceptance**
- Fresh install opens the onboarding tab.
- After picking a calibration option, the popup shows a real goal.
- Monthly recalibration updates the goal smoothly (no jumps > 20% of the delta).

---

### Phase 4 — Popup redesign (ring + cumulative)

Replaces the streak card with the ring + cumulative layer while preserving the existing visual language (orange accent, dark card style, view-switching system).

**Changes**
- `popup/popup.html`:
  - Remove `<div class="streak-card">` and all `streak-*` markup.
  - Add `<div class="ring-card">` containing an SVG ring (radius ~50, stroke ~10), percentage label in the center, and a "Clean browsing today" caption.
  - Add `<div class="cumulative-card">` with three stat lines: closed days, reflections logged, lifetime hours.
  - Keep header, status badge, disable timer card, all four disable-flow views, footer.
- `popup/popup.css`:
  - New `.ring-card` styles using the same card aesthetic as `.streak-card` (same border-radius, same background gradient, same shadow). Replace the fire emoji + streak value with the SVG ring as visual centerpiece.
  - New `.cumulative-card` styles (compact, less prominent than the ring card).
  - Remove all `.streak-*` rules.
- `popup/popup.js`:
  - Replace `updateStreakDisplay` with `updateRingDisplay`: reads `today.cleanMinutes`, `goalMinutes`, computes percentage, sets SVG `stroke-dasharray`. Reads `totals` for the cumulative card.
  - Subscribe to storage changes on `today`, `totals`, `goalMinutes`.
  - Remove `MAX_DAILY_REDIRECTS` references, streak messaging logic, warning border colors.
  - Remove the debug button injection at the bottom of `popup.js`.
- Keep all four disable-flow views and the passphrase mechanism unchanged (still good design).

**Acceptance**
- Popup shows a filling SVG ring whose stroke length matches `cleanMinutes / goalMinutes`.
- Below the ring, three small stats: `Closed days`, `Reflections`, `Lifetime hours`.
- No streak number, no "streak will reset" warning, no "1 block left today" UI.
- Visual style matches the rest of the popup (no jarring difference).

---

### Phase 5 — Clean browsing time tracker

Wires up the actual measurement that the ring depends on.

**Changes**
- `background.js`:
  - New `chrome.alarms.create("cleanMinuteTick", { periodInMinutes: 1 })`.
  - On tick: check `enabled`, query active tab, check `chrome.idle.queryState(60)` is `"active"`, confirm the active tab isn't currently a redirect page. If all pass, increment `today.cleanMinutes` by 1.
  - On redirect fire: do NOT decrement; just skip the current minute's increment by setting a `lastRedirectAt` timestamp and ignoring the increment if it's within 60s.
- Update `totals.lifetimeCleanMinutes` and check `ringClosed` on each increment.
- On ring closure (cleanMinutes crosses goalMinutes): set `today.ringClosedAt`, increment `totals.closedDays`, fire a quiet animation message to any open popup.

**Acceptance**
- Leaving laptop idle for 5 minutes doesn't add to clean minutes.
- Active browsing accumulates ~1 minute per minute.
- Popup ring fills in real time when the popup is open.

---

### Phase 6 — Redirect page redesign

Replaces guilt UI with the reflection prompt.

**Changes**
- `redirect/redirect.html`:
  - Remove streak display, micro-action button, 60-second countdown overlay (and its overlay DOM).
  - Top: small "Pause." heading + one-line reason text (compact, less prosecutorial).
  - Center: "What's actually going on right now?" + 6 chips in a 2×3 grid (Bored / Stressed / Habit / Avoiding something / Lonely / Tired).
  - Bottom row, smaller: "Take a beat" link (opens breathing animation) and "This was wrongly flagged" link (triggers appeal flow).
  - First-redirect-ever variant adds a single line above the chips: "First time here — pick what fits. Only you ever see this."
- `redirect/redirect.css`:
  - Restrained palette — soft neutral background, no alarming red, accent matches the popup's orange but used sparingly.
  - Chips: large tap targets, rounded, no fill until tapped; on tap, fill + slight scale, then transition to confirmation state.
  - Breathing animation overlay: a single circle that expands and contracts 4s/4s/4s for 3 cycles (~36s), no text instructions.
- `redirect/redirect.js`:
  - On chip tap: record reflection (`shared/storage.recordReflection({ chip, domain })`), increment `today.reflections`, increment `totals.reflectionsLogged`, show "Logged. N → N+1." confirmation for 1.5s, then offer "Close tab" or "Take me back" (appeal-approved case).
  - Remove all current micro-action / countdown / streak loading code.
  - Appeal click: still sends `appealRequest` to background, but the UI doesn't pretend to be doing AI analysis until Phase 8 actually wires up NSFW.js. Until then, appeal uses the current keyword-only path; just rename the user-facing strings to be honest.

**Acceptance**
- Tapping a chip writes a reflection entry and transitions to a confirmation state.
- No streak counter visible.
- "Take a beat" plays a breathing animation that auto-completes.
- First-redirect-ever shows the intro line; subsequent redirects don't.

---

### Phase 7 — Calendar heatmap

Adds the lifetime history visualization to the popup.

**Changes**
- `popup/popup.html`: new `<section class="heatmap">` containing a grid of cells (last 90 days as a 12×8 grid, or last 30 days as a compact strip — pick during build).
- `popup/popup.css`: each cell colored by `cleanMinutes / goalMinutes` ratio in 5 buckets (0%, 25%, 50%, 75%, 100%), using shades of the orange accent. Empty cells (pre-install days) shown muted.
- `popup/popup.js`: render from `history`. No streak overlay, no "longest run" caption, no count of consecutive closed days.

**Acceptance**
- Heatmap shows past N days with intensity based on ring fill %.
- Hovering a cell shows the date + the % (tooltip).
- No streak-style framing anywhere.

---

### Phase 8 — Real screenshot detection via NSFW.js + offscreen doc

The big architectural piece. Adds genuine computer vision.

**Changes**
- `manifest.json`: add `"offscreen"` permission.
- New `offscreen/offscreen.html`, `offscreen.js`: hosts TensorFlow.js + NSFW.js, listens for messages from background.
- Bundle NSFW.js model files (~4 MB) under `vendor/nsfwjs/` and the loader under `vendor/tfjs/`.
- `background.js`:
  - `ensureOffscreen()` lazily creates the offscreen document on first need.
  - New `classifyScreenshot(tabId)` flow: `chrome.tabs.captureVisibleTab` → send PNG dataURL to offscreen → offscreen runs NSFW.js → returns `{ porn, hentai, sexy, drawing, neutral }` probabilities.
- Wire into two places:
  1. **Ambiguous detection band.** When the content-script keyword score falls in `[3, 7]`, background runs `classifyScreenshot`. If `porn + hentai + sexy > 0.6`, redirect. Otherwise let through.
  2. **Appeal flow.** When user clicks "This was wrongly flagged", run `classifyScreenshot` on the *current* page (the original URL, after a `chrome.tabs.update` to reload). If `neutral + drawing > 0.85`, unblock and add to `safeDomains`. Show real probabilities in the result UI.
- Remove the `analyzePageContent` function and `performLightweightAnalysis` (the keyword-pass-pretending-to-be-AI).
- Remove `AppealRateLimiter` class — with a real classifier, repeated appeals don't change the answer, so arbitrary cooldowns aren't needed.

**Acceptance**
- A safe page in the ambiguous band (e.g. a clothing retailer with the word "sexy" in URL) is correctly classified `neutral` and not blocked.
- An adult page that snuck past keyword detection is correctly flagged by NSFW.js.
- Appeal on a falsely-flagged page surfaces honest probabilities ("Detected 89% likely Neutral").
- Cold-start latency on first classification < 3s; subsequent classifications < 500ms.

---

### Phase 9 — Insights view in popup

Surfaces patterns once enough reflection data exists.

**Changes**
- `popup/popup.html`: new `<section class="insights">` shown only when `totals.reflectionsLogged >= 10`.
- Contents:
  - "Most common trigger" — bar list of top 3 chips by count, with percentages.
  - "Peak hours" — bar of redirect frequency by hour-of-day, top 2 windows highlighted.
- `popup/popup.js`: aggregator function reads `reflections[]`, groups by chip and by hour-of-day bucket, renders bars.

**Acceptance**
- With < 10 reflections, the section isn't rendered.
- With 10+, charts appear and update on new reflections.
- All aggregation is read-only — no writes triggered by viewing.

---

### Phase 10 — Badge ring arc

Always-on glanceable ring on the extension icon.

**Changes**
- `background.js`: on each clean-minute increment (and on relevant storage changes), call `chrome.action.setIcon` with a dynamically-generated canvas containing a base icon + colored arc matching the ring fill %.
- Canvas drawing helper in `background.js` using an `OffscreenCanvas`.
- Throttle to once per minute to avoid icon churn.

**Acceptance**
- Extension toolbar icon shows an arc that fills as the day progresses.
- Arc visually closes when the ring closes.
- Arc resets at local midnight.

---

### Phase 11 — Export / Import

User-controlled backup story.

**Changes**
- `popup/popup.html`: new "Your data" subsection with two buttons: "Export" and "Import."
- `popup/popup.js`:
  - Export: read full storage, format as JSON, trigger download via `<a download>`.
  - Import: file picker → JSON parse → validate `schemaVersion` → run migrations if needed → ask user "Replace existing data or merge?" → apply.

**Acceptance**
- Export produces a valid JSON file with the full schema.
- Importing that file on a fresh install restores all state correctly.
- Importing an older-schema file triggers migrations and still works.

---

### Phase 12 — Cleanup & docs

Remove all the dead code and align README with reality.

**Changes**
- Delete: `clearAppealData`, all `appealHistory_*`, `appeals_*`, `appealCooldowns` keys, `AppealRateLimiter`, `analyzePageContent`, `performLightweightAnalysis`, all legacy streak storage keys, hardcoded debug button in popup, the duplicated `adultAnchors` Set.
- `manifest.json`: bump version to `1.0.0`, finalize permissions list.
- Update `README.md`:
  - Replace "Optional: TensorFlow.js or NSFW.js for image classification" with the actual fact (real CV on appeals + ambiguous detection).
  - Remove "Future plans" items that are now done.
  - Add a section on the ring + cumulative model and why streaks were removed.
  - Add a "Privacy" section explicitly stating: all data local, export/import for backup, no servers.

**Acceptance**
- `grep -r streak` finds zero results in production code (only `goalMinutes`, `ringClosed`, etc.).
- README claims match implementation.
- No console warnings on a fresh install.

---

## 4. File map

```
CleanTab/
├── manifest.json
├── README.md
├── plan.md                           ← this file
├── Assets/
├── background.js                     ← slimmed; delegates to shared/
├── content.js                        ← slimmed; word-boundary regex
├── shared/                           [NEW]
│   ├── storage.js
│   ├── schema.js
│   ├── dates.js
│   ├── keywords.js                   ← single source of truth, was duplicated
│   ├── goal.js
│   └── migrations/
│       └── v0_to_v1.js
├── onboarding/                       [NEW]
│   ├── onboarding.html
│   ├── onboarding.css
│   └── onboarding.js
├── offscreen/                        [NEW]
│   ├── offscreen.html
│   └── offscreen.js
├── vendor/                           [NEW]
│   ├── tfjs/
│   └── nsfwjs/
├── popup/
│   ├── popup.html                    ← ring + cumulative + heatmap + insights
│   ├── popup.css                     ← preserves current look
│   └── popup.js
└── redirect/
    ├── redirect.html                 ← reflection chips + take a beat + appeal
    ├── redirect.css
    └── redirect.js
```

---

## 5. Open small decisions (resolve during build)

1. **Heatmap layout** — 12×8 grid of last 90 days (square) vs. compact 30-day strip. Will decide visually during Phase 7.
2. **Breathing animation length** — 3 cycles (~36s) vs. 4 cycles (~48s). Will pick whichever feels less rushed in user testing.
3. **First-redirect intro reset on reinstall** — show again after each fresh install (helpful) or once ever (cleaner). Leaning toward "after each fresh install" since data export/import is the user's continuity story.
4. **NSFW.js threshold for unblock** — `neutral + drawing > 0.85` is a starting point; tune against real false-positive examples during Phase 8.
5. **Clean minute granularity** — strict 1-minute increments vs. continuous seconds. Strict minutes is simpler and the resolution is fine for a goal of 60–240 minutes.

---

## 6. Non-goals for v1

- Cross-device sync (deferred until there's demand).
- Cloud backup (export/import covers the gap).
- Free-text reflections (chips-only for v1; revisit if "Other" pattern emerges).
- Image classification on every page (only on ambiguous band + appeals — performance cost not worth it elsewhere).
- TypeScript migration (worth doing eventually, but not blocking).
- Tests / CI (worth adding before Phase 8 to lock down the storage layer, but not in scope of the visible work).

---in

## 7. Post-redesign cleanup (queued 2026-05-19)

Issues surfaced during review of the light-mode popup + ring + guard pass. Ordered by impact.

### 7.1 Heatmap legend mismatch (visible bug)
- **Where:** `popup/popup.html:97-103`
- **Problem:** Legend swatches still use the old dark-mode hex stack (`#1E1E1E → #FF6B35`) while `popup/popup.js:290-295` now paints cells with the cream/orange light-mode stack (`#F0EDE7 → #FF6B35`).
- **Fix:** Update legend swatches to `#F0EDE7, #FFE9DB, #FFD0B5, #FFAA7A, #FF6B35` so "Less → More" actually matches the grid.
- **Acceptance:** Visual diff of legend cells matches the lowest five tiers in the grid renderer.

### 7.2 Onboarding still dark-themed
- **Where:** `onboarding/onboarding.css` (`--bg: #0B0B0B`, full dark palette)
- **Problem:** First-run experience is dark; popup is light. Jarring brand inconsistency on the very first impression.
- **Fix:** Repaint onboarding to the popup's light palette (`--bg: #FFFFFF`, `--s1: #F8F6F2`, `--text: #1C1915`, etc.). Keep Bricolage headline + DM Sans body + orange accent. Re-check goal-preview contrast and `.chip` selected state on the new background.
- **Acceptance:** Open onboarding side-by-side with the popup; same paper-cream feel, no dark surfaces.

### 7.3 Insights dual source of truth
- **Where:** `popup/popup.js:304-340` (`renderInsights`)
- **Problem:** Gate uses `totals.reflectionsLogged`; bar counts come from iterating `reflections[]`. If the two drift (import, manual edit, future bug), the gate opens but the bars are empty — or vice versa.
- **Fix:** Pick one source. Recommended: derive both from `reflections.length` (gate + counts), and treat `totals.reflectionsLogged` as a denormalized convenience only.
- **Acceptance:** Manually setting `totals.reflectionsLogged` out of sync with `reflections[]` does not break the panel.

### 7.4 Detection regex test harness
- **Where:** new `tests/` directory (no infra exists yet)
- **Problem:** `getKeywordScore` and `PASSTHROUGH_PARAMS` are the most regression-prone code in the project; any future keyword tweak could silently re-introduce the Google-login false positive.
- **Fix:** Add a minimal Node-runnable test file (no framework — `node --test` is fine) that exercises:
  - known false-positive corpus (Google login URL, "Essex" prose, "camera shop" page text) — must score 0 or below threshold
  - known true-positive corpus (a handful of unambiguous adult domain/keyword combos) — must score above threshold
  - passthrough-param behavior on `continue=`, `redirect_uri=`, `next=`
- **Acceptance:** `node --test tests/detection.test.js` passes locally; add a one-line note to README on how to run it.

### 7.5 Passphrase honesty note
- **Where:** `popup/popup.js:160` (hardcoded `PASSPHRASE`)
- **Problem:** The string is plainly visible in source — anyone reading the code can bypass it. That's fine *if* the goal is friction, not secrecy, but it's not documented.
- **Fix:** One-line comment at the constant clarifying intent ("friction, not security — visible in source by design"). No behavioral change.
- **Acceptance:** Comment present; no functional change.

### 7.6 (Optional, deferrable) NSFW.js bundle in git
- **Where:** `vendor/nsfwjs/nsfwjs.min.js` (2.7MB tracked)
- **Problem:** Inflates clone size; every model update is a 2.7MB commit.
- **Fix candidates:**
  - Keep as-is (current; simplest, zero-network install).
  - Move to a `postinstall` script that curls the bundle from a pinned release URL into `vendor/` (smaller repo, requires network on install).
- **Recommendation:** Defer until the bundle changes for the first time. Re-evaluate then.

### Execution order
Land 7.1 + 7.2 + 7.3 + 7.5 in a single commit (UI polish + safety). 7.4 as its own commit (introduces test infra). 7.6 stays parked until there's a reason to touch the vendor bundle.

---

## 8. Visual-first detection + intention-aware dwell (Phase 8 — queued 2026-05-19)

### 8.1 The gap we're closing
Today's detection is **text-only**. The page's DOM text + URL + titles drive every redirect; NSFW.js exists only as a false-positive-reducer on appeal (`background.js:392`). That leaves a real blind spot on image-first platforms — Pinterest, Reddit image subs, Twitter/IG feeds, Tumblr, image search — where a sanitized text shell can wrap visually suggestive imagery. Pinterest is the cleanest example: `pinterest.com/pin/123` has near-zero text signal, isn't in `knownAdultDomains`, and doesn't match `isInsidePost`'s `/p/` or `/post/` patterns (`content.js:139-153`). Result: nothing fires.

We also have the opposite problem in feeds: even if we *did* scan images, a fast scroll past a borderline image isn't the same as stopping on it. The user's intention is the signal we actually care about.

### 8.2 Design rationale: dwell as the signal
A redirect is a heavy interruption. Firing it on every flagged image that scrolls through the viewport would be:
- **High false-positive rate** — feeds mix everything; one borderline thumbnail among 30 is noise, not intent.
- **Demoralizing** — punishes scrolling, not engagement.
- **Misaligned with the ring model** — the whole product premise is that *the user is steering*, not that we're flagging every pixel.

Dwell (≥2s in viewport, page not scrolling) is a behavioral proxy for "I stopped because this caught my eye." That maps to the moment a user would actually benefit from a redirect. Scroll-past gets ignored; lingering gets classified.

### 8.3 Architecture

**Two new pieces in the content script:**
1. **Dwell observer** — `IntersectionObserver` on `<img>` elements above a size threshold (e.g., ≥ 180×180 px to skip avatars/icons). When an image enters ≥50% visibility AND the page is not actively scrolling, start a 2000ms timer. On scroll, blur, or visibility exit, cancel. On timer fire, mark the image as "dwelled" and request classification.
2. **Classification request** — Send `{action: "classifyImage", src: <img.src>, tabId}` to background. Throttle: max one in-flight + one queued per tab; min 3s between classifications per tab.

**Background extension:**
- New handler `classifyImage` → `fetch(src)` (cross-origin works because we have `<all_urls>` host permission) → blob → send to offscreen doc → NSFW.js classifies the blob, not a tab screenshot.
- `offscreen/offscreen.js` already has `nsfwjs.load()`; add a `classifyBlob` message handler alongside the existing `classifyScreenshot`.

**Decision logic:**
- Reuse existing `isLikelyUnsafe(prediction)` (`background.js:134`).
- If unsafe: send `{action: "redirect", reason: "Image dwell on flagged content"}` to the content script of that tab.
- If safe: silently mark the image as "cleared" in a WeakSet so we never re-classify it within the page lifetime.

**Platform allowlist for dwell scanning** (start narrow, expand on data):
- pinterest.com (all pages)
- reddit.com (subreddit + post pages)
- twitter.com / x.com (home + explore)
- instagram.com (explore + reels)
- tumblr.com
- google.com/search?tbm=isch (image search)

Outside this list, dwell scanning is off. Cheap text scoring stays as the global default. This avoids burning a 200–500ms TF.js inference on every Wikipedia hero image.

### 8.4 Open questions to resolve during build
1. **Dwell duration** — 2s is the user's number. Tune against real usage; probably 1.5–3s window. Should be a constant, not magic.
2. **What counts as "scrolling stopped"** — `scrollend` event (newer browsers) or a 250ms quiet period after the last `scroll` event. Latter is more compatible.
3. **Cross-origin image fetch failures** — some CDNs block direct fetch. Fallback: ask the content script to draw the `<img>` to an `OffscreenCanvas` and ship the resulting blob. Slower path; only needed when fetch fails.
4. **Per-tab rate limit** — protects against a feed where 10 images all clear the dwell threshold within seconds. Likely 1 classification per 3s, queue depth 1.
5. **Replays after redirect dismissal** — if the user appeals successfully on a dwelled image, the page should not immediately re-flag the same image. WeakSet of "cleared this lifetime" per tab.
6. **Battery / CPU on laptops** — TF.js inference is non-trivial. Need to confirm we're not destroying battery on a Pinterest browse session. Possible mitigation: skip dwell scanning when `navigator.getBattery()` reports discharging + low.

### 8.5 Risks honestly
- **NSFW.js model is general-purpose, not state-of-the-art.** Borderline cases (lingerie ads, art, swimwear) will misfire in both directions. We'll need the existing appeal flow to remain easy.
- **Image fetch latency** can stretch dwell-to-redirect to 1–3s on slow networks — the redirect arrives after the user has *already* moved on. Acceptable; non-blocking is more important than instant.
- **Adds CPU work to every page in the allowlist.** Even idle, the IntersectionObserver costs. The platform allowlist contains this.
- **Could feel surveillance-y if poorly tuned.** A redirect 2s after pausing on an art piece is a worse UX than no redirect at all. Bias toward higher thresholds early; loosen if users report misses.

### 8.6 Acceptance criteria
- Pinterest pin page with overtly NSFW imagery → user lingers 2s → redirect fires with the dwell reason string.
- Pinterest feed scroll-through (no lingering) → no redirect, no classifications kicked off.
- Wikipedia article with a swimwear photo → no classification kicked off (not in allowlist) → no redirect.
- A clean Pinterest pin lingered on for 5s → classification runs once, returns safe, never re-runs for that image.
- Battery impact measurable: ≤ 5% additional CPU averaged over a 10-minute Pinterest browse vs. extension disabled (rough; document the measurement, don't gate on it).

### 8.7 Files this will touch (estimated)
- `content.js` — new `DwellObserver` module + scroll-state tracker + message sender.
- `background.js` — new `classifyImage` handler + per-tab rate limiter + blob → offscreen pipe.
- `offscreen/offscreen.js` — add `classifyBlob` handler.
- `manifest.json` — already has `<all_urls>`; no new perms expected.
- New constants: `VISUAL_PLATFORMS`, `DWELL_MS`, `MIN_IMAGE_SIZE`, `CLASSIFY_RATE_MS`. Group in `shared/keywords.js` or a new `shared/visual.js`.

### 8.8 Execution
This is a meaningful feature — separate phase, separate commit, possibly a feature flag (`enableDwellDetection` in storage, default off until tuned). Land behind the flag, dogfood on Pinterest for a week, then default on.

---

## 9. Improvement plan (queued 2026-09-16)

Written after a full audit of the shipped code. Phases 13–20 continue the numbering from §3.

### 9.0 The ordering argument

The audit found that the appeal flow classifies CleanTab's own redirect page instead of the
flagged page (`background.js:432`), that approved appeals don't take effect on `www.` hosts
(`background.js:419` vs `content.js:297`), and that "clean minutes" counts any active tab
regardless of what's on it (`background.js:325`).

That matters for sequencing: **the ring, the heatmap, the badge, the goal calibration and
every popup stat are all views onto a number that isn't measuring what its label claims.**
Polishing the popup before fixing the metric would be building a nicer window onto the
same wrong room. So Phase 13 and 14 are prerequisites, not housekeeping.

The popup work (17–18) is where most of the *felt* improvement lands, and it's blocked on
one insight: **the popup currently has no idea what tab it's open on.** It shows lifetime
trophies. It should show a control surface for the page in front of the user.

---

### Phase 13 — Correctness foundation

Blocking. Nothing below is worth building until detection means something.

**Changes**
- `background.js` appeal handler: before classifying, navigate the tab back to the original
  URL, wait for `tabs.onUpdated` → `complete`, *then* `captureVisibleTab`. If the
  verdict is unsafe, redirect again. Without this the classifier never sees the page it is
  judging, and every reason string it prints is false.
- New `shared/domains.js` with a single `normalizeDomain(hostname)` (lowercase, strip
  leading `www.` only, anchored). Use it on **both** the write side (`addSafeDomain`) and
  the read side (`content.js` safe-domain check). Currently they disagree, so an approved
  appeal sends the user into a redirect loop.
- Bundle the NSFW.js model weights under `vendor/nsfwjs/model/` and pass
  `chrome.runtime.getURL("vendor/nsfwjs/model/model.json")` to `nsfwjs.load()`.
  The bare `load()` fetches from a CloudFront CDN — the "self-contained bundle" comments in
  `offscreen/offscreen.js:5` and `vendor/SETUP.md` are wrong, and the README's
  "no external APIs" claim is currently false.
- Self-host Bricolage Grotesque + DM Sans under `Assets/fonts/`. Three pages hit
  `fonts.googleapis.com` today, so every block event pings Google and the redirect page
  renders in fallback fonts offline.
- Stop putting the blocked URL in the address bar. `background.js:260` writes the full
  original URL into `?original=`, which lands it in the omnibox, history and session
  restore. Store it in `chrome.storage.session` keyed by tab ID; pass an opaque token.
- `content.js`: run the first scan unconditionally when `document.readyState === "complete"`,
  not only from the `load` listener. At `document_idle` the load event has often already
  fired, so on those pages the initial scan never happens at all.
- Resolve `shared/`: it is entirely dead code. Load it via `importScripts` in the service
  worker and as content-script files in the manifest, or delete it. Three divergent copies
  of the keyword list (`background.js:1`, `content.js:54`, `shared/keywords.js`) already
  disagree about `nude`.
- Drop unused `scripting` and `activeTab` from `manifest.json`.

**Acceptance**
- Appealing a genuinely NSFW page is denied with a percentage derived from that page.
- Appealing a falsely-flagged page on a `www.` host returns the user there and keeps them
  there.
- Detection works with the network off.
- One keyword list exists in the repo.

---

### Phase 14 — Make the metric true

**The problem.** `tickCleanMinute` increments for any active, non-idle, non-redirect tab.
It is a browsing-time counter labelled as a virtue.

**Changes**
- Content script reports a verdict after each scan:
  `{action: "tabVerdict", clean: bool, score: n}` → background stores it in
  `chrome.storage.session` under the tab ID.
- `tickCleanMinute` increments only when the active tab has a recent (< 2 min) `clean: true`
  verdict. No verdict (never scanned, restricted page, `chrome://`) counts as neutral —
  it does not increment, and it does not break the ring.
- Relabel throughout: "Clean browsing" → **"Clean minutes — time browsing with nothing
  flagged."** Say what it counts.
- Reset the badge icon on rollover and when protection is paused (`updateBadgeArc`
  currently paints once and leaves the stale arc up forever).

**Acceptance**
- Sitting on a flagged-but-appealed page does not accrue clean minutes.
- Closing the laptop for an hour changes nothing (already true; keep it true).
- The number in the ring can be explained in one sentence without hedging.

---

### Phase 15 — Scoped unblocking (replaces the appeal)

**The problem.** The only escape hatch is a permanent, invisible, domain-wide whitelist with
no UI to review or revoke it. That is the heaviest possible response to "this was a false
positive on one page."

**Changes**
- Three outcomes on the redirect page instead of one button:
  1. **"Let me through once"** — allows the exact URL for 10 minutes. No classifier, no
     permanent state. This is the common case and should be cheap.
  2. **"This site is fine"** — runs the real classifier (Phase 13). On safe, adds a
     *reviewable* trust entry (Phase 18). On unsafe, denies with honest probabilities.
  3. Nothing — close the tab.
- Trust entries become records, not bare strings:
  `{ domain, addedAt, source: "appeal" | "manual", expiresAt: null }`.
  Migrate existing `safeDomains` strings in a `v1_to_v2` migration.
- Rate-limit outcome 1 to 3 per domain per day, then it escalates to outcome 2.
  `cooldownUntil` already exists in the schema and is never read; wire it here.

**Acceptance**
- A one-off false positive costs one click and leaves no permanent state.
- Every permanent trust decision is visible in the popup and revocable.

---

### Phase 16 — Sensitivity as a user control

**The problem.** Every threshold is a hardcoded magic number (`urlScore >= 5`,
`explicitTitleScore >= 6`, `textScore >= 3`, `unsafe > 0.6`). A user who finds CleanTab too
twitchy or too loose has exactly one lever: turn it off entirely. That is the most likely
reason someone uninstalls.

**Changes**
- New `shared/thresholds.js` exporting three named profiles:

  | | Strict | Balanced (default) | Lenient |
  |---|---|---|---|
  | `urlScore` | 3 | 5 | 8 |
  | `titleScore` | 4 | 6 | 9 |
  | `textScore` | 2 | 3 | 5 |
  | NSFW.js unsafe | 0.45 | 0.6 | 0.75 |
  | Dwell scanning | on | on | off |

- `sensitivity: "balanced"` in the schema; content script and background read the profile
  rather than literals.
- `enableDwellDetection` flag, defaulting **off** until tuned — §8.8 already called for this
  and it shipped on by default instead.

**Acceptance**
- No comparison against a numeric literal remains in the detection path.
- Switching profiles takes effect on the next scan without a reload.

---

### Phase 17 — Popup: the "Now" surface

**The diagnosis.** The popup today is a trophy case: a ring, three lifetime counters, a
heatmap. Nothing on it is actionable, nothing changes between openings, and — the core
miss — **it never mentions the tab you're looking at.** You open it on Reddit and it tells
you a percentage. There is no reason to open it twice.

**The reframe.** The popup's first screen should answer *"what is CleanTab doing on this
page right now, and what can I do about it?"* Progress is the second question, not the first.

**Target layout (380×560, "Now" tab):**

```
┌────────────────────────────────────┐
│ CleanTab                ● Active   │
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │
│ │ ◐ reddit.com        Protected  │ │  ← new: current-tab card
│ │ Scanned 2s ago · risk 2 / 5    │ │
│ │ [ Trust site ]  [ Pause 15m ]  │ │
│ └────────────────────────────────┘ │
│                                    │
│            ╭────────╮              │
│           │   68%    │             │  ring, 140px (was 180)
│            ╰────────╯              │
│         38 min to close            │
│                                    │
│   12          3           47       │
│ Closed      Blocks    Reflections  │
│  days       today                  │
│                                    │
│ ┌────────────────────────────────┐ │
│ │ Most common trigger: Bored 41% │ │  ← one live insight, not
│ └────────────────────────────────┘ │     buried behind a tab
├────────────────────────────────────┤
│  Now   Progress   Sites   Guard    │
└────────────────────────────────────┘
```

**Changes**
- Query the active tab on open; render hostname + favicon + one of four states:
  **Protected** / **Trusted** (with "stop trusting") / **Paused here** / **Not scanned**
  (`chrome://`, PDF viewer, restricted page — say so rather than implying coverage).
- Show the last scan's risk score and age. Detection is completely opaque today; this is
  the cheapest possible way to make the product feel alive and honest.
- **Pause for this site** (15 min / 1 h / today) as a middle option between "endure it" and
  "disable everything." Site-scoped pause needs no passphrase; global disable keeps the
  full friction. Right now every pause is nuclear, which trains users to nuke.
- Shrink the ring to 140px to make room. It is currently 32% of the popup's height for a
  number that changes once a minute.
- Surface the top trigger inline once ≥10 reflections exist, instead of leaving the
  Progress tab's insight section hidden behind an empty state most users never clear.

**Acceptance**
- Opening the popup on three different sites produces three visibly different screens.
- A user can tell, without leaving the popup, whether the current page is being scanned.

---

### Phase 18 — Popup: "Sites" tab

**The problem.** `safeDomains` is a write-only list. Nothing in the UI shows it, and nothing
can remove from it. Combined with the appeal bug in Phase 13, a user could accumulate a
dozen permanent bypasses without ever seeing one.

**Changes**
- New fourth tab listing trusted sites: domain, when added, how (appeal vs manual), and a
  revoke button. Empty state explains what lands here.
- "Add a site manually" input, so trusting a site doesn't require getting blocked first.
- Below it: **recently flagged** (last 10 blocks, from `reflections[].domain` plus a new
  `blocks[]` ring buffer) with a one-tap "this keeps being wrong → trust it" and a one-tap
  "this is right → never ask again".
- Move Export/Import from Guard into this tab's footer; Guard becomes purely the
  protection toggle plus the sensitivity selector from Phase 16.

**Acceptance**
- Every permanent trust decision the extension has ever made is visible in one list.
- Revoking takes effect on the next scan without a reload.

---

### Phase 19 — Honest failure states

**The problem.** Every failure path resolves to "safe" and says nothing. Model can't load →
`null` → appeal falls back to keyword score. Image fetch 403s on an Instagram CDN → `null` →
treated as clean. Offscreen document dies → silent. The user's experience of a broken
detector is identical to a working one that found nothing.

**Changes**
- Track `detectionHealth` in `chrome.storage.session`: model loaded, last classification
  result, consecutive fetch failures.
- Surface it in the popup header badge: **Active** / **Active (text only)** when the model
  is unavailable / **Paused**. Never claim image analysis that isn't running.
- Implement the canvas fallback §8.4.3 already specified: when background `fetch(src)` fails,
  ask the content script to draw the `<img>` to an `OffscreenCanvas` and ship the blob.
  Cross-origin CDN blocks are the common case on exactly the platforms dwell targets.
- Debounce the `MutationObserver` in `startDwellObserver` (`content.js:505`) and scan only
  `addedNodes`. It currently re-runs `querySelectorAll("img")` over the whole document on
  every mutation — on an infinite feed that is the dominant CPU cost, and §8.5 flagged the
  battery risk without the mitigation landing.

**Acceptance**
- Offline, the popup says "text only" rather than "Active".
- A 10-minute Pinterest scroll shows no sustained main-thread cost from the observer.

---

### Phase 20 — Onboarding v2

**The problem.** Onboarding asks exactly one question — hours per day — and uses it to set a
goal for a metric that (pre-Phase 14) doesn't measure what it says. It never explains what
CleanTab does, what gets blocked, or that a screenshot is taken during appeals.

**Changes**
- Three screens: *what this does* (one sentence + the honest limits) → *sensitivity*
  (Phase 16 profiles, with an example of what each would block) → *your daily estimate*
  (existing chips).
- Disclose the screenshot-on-appeal behavior explicitly. It is defensible and local, but it
  should not be a surprise discovered in the source.
- Offer "import a backup" on the first screen for reinstalls.

---

### 9.1 Open decisions

1. **The ring rewards more browsing.** A user who shuts the laptop at 20% has a worse-looking
   day than one who scrolled cleanly for four hours. That is inverted for a focus product.
   Options: (a) keep it, leaning on `recalibrateGoal`'s median anchoring so the goal tracks
   what the user already does; (b) cap the ring at the goal and show overage separately;
   (c) reframe the ring as "clean share of browsing time" — a ratio, not a total, which a
   short clean day closes just as well as a long one. **Leaning (c)** — it is the only one
   where closing the laptop isn't a penalty. Needs a call before Phase 14 locks the schema.
2. **Site-scoped pause vs. passphrase.** Making per-site pause frictionless may become the
   default bypass. Mitigation: cap at 3 site-pauses per day, then require the passphrase.
3. **Dwell default.** Ship Phase 16 with dwell off and let users opt in, or keep it on for
   the visual platforms? Off is more honest until §8.6's acceptance criteria are actually
   measured.
4. **Fourth tab vs. overflow.** Four tabs at 380px is tight. Alternative: fold Guard into a
   gear icon in the header and keep three tabs.

### 9.2 Non-goals for this round

- ~~Tests and CI~~ — **done, see §9.5.** Kept out of the feature commits and landed as its
  own layer, which is what let it surface two real bugs instead of ratifying the code.
- Replacing NSFW.js with a better model.
- Cross-device sync.
- Firefox port.

### 9.3 Suggested execution order

Phase 13 → 14 → 17 → 18 → 16 → 15 → 19 → 20.

13 and 14 are prerequisites. 17 and 18 are next because they deliver the most visible
improvement per hour and make everything else inspectable. 16 before 15 because scoped
unblocking wants configurable thresholds to be meaningful. 19 and 20 are the honesty pass
once the machinery is real.

---

### 9.4 Build log — 2026-09-16

Phases 13–20 implemented in one pass. What landed, and where it diverged from the plan above.

**Phase 13 — correctness.** Appeal rewritten (see deviation below). `shared/domains.js` now owns
`normalizeDomain()` and both the write and read sides call it. Model weights vendored to
`vendor/nsfwjs/model/` (2.7 MB, MobileNetV2) and passed explicitly to `nsfwjs.load()`. Fonts
self-hosted to `Assets/fonts/` (192 K after deduping the variable-font shards — Bricolage's
600/700/800 faces are byte-identical). Blocked URLs moved from the query string to
`chrome.storage.session` keyed by tab. Content script scans when `readyState === "complete"`
rather than relying on a `load` listener registered too late. `shared/` is live: loaded via
`importScripts` in the worker and via the manifest for content scripts. `scripting` and
`activeTab` dropped from the manifest.

**Phase 14 — the metric.** Content script reports `{clean, score}` per scan into session
storage; `tickMinute` reads the active tab's verdict. Both `cleanMinutes` and
`browsedMinutes` are recorded. A tab that could not be scanned advances neither counter.

**Ring model — resolved.** §9.1's open question was settled as option (c) plus context:
the ring fills on **clean share** (`cleanMinutes / browsedMinutes`), and the minute totals
sit underneath as context rather than as the goal. `MIN_BROWSED_FOR_CLOSE = 20` stops one
clean minute reading as a closed day. `cleanShare()` and `ringIsClosed()` live in
`shared/schema.js` so the ring, the rollover and the heatmap cannot drift apart.
`goalMinutes` is retained — it is still the onboarding estimate — but no longer gates the ring.

**Phase 15 — scoped unblocking.** Redirect page now offers "Let me through once"
(URL-scoped, 10 min, session-only, no permanent state) and "This site is fine" (real check,
permanent trust record). `trustedSites` records replace `safeDomains` strings via
`v1_to_v2`. Legacy entries are preserved but tagged `appeal-legacy` and flagged for review
in the Sites tab, since the flow that created them approved almost everything.

**Phase 16 — sensitivity.** `shared/thresholds.js` holds three profiles. No numeric literal
remains in the detection path. Selector on the Guard tab and in onboarding.

**Phases 17 / 18 — popup.** Now / Progress / Sites / Guard. Current-site card with four
honest states, risk score and scan age, per-site pause (15 min / 1 h / rest of day), trust
toggle. Ring shrunk 180 → 140 px. Top trigger surfaced inline. Sites tab lists every trust
entry with source and age, plus recent blocks with one-tap trust, and a manual add field.
Heatmap recoloured by clean share; days with no tracked browsing render blank rather than dark.

**Phase 19 — health.** `detectionHealth` in session storage; header badge reads **Active** /
**Text only** / **Paused** and never claims image analysis that isn't running. Canvas
fallback for CDN-blocked fetches implemented (§8.4.3). `MutationObserver` debounced to
400 ms and scoped to `addedNodes`. Dwell scanning defaults **off** (§8.8's flag, finally).

**Phase 20 — onboarding.** Three steps: what it does (including "it will get things wrong")
→ sensitivity → daily estimate. Restore-a-backup on step one.

#### Deviation: the appeal reviews page images, not a screenshot

Phase 13 specified navigating the tab back to the original URL and screenshotting it. Two
problems surfaced during the build:

1. The redirect page lives **in the tab being navigated**, so it is destroyed mid-check and
   `sendResponse` never arrives. The flow would have to bounce back with a query param.
2. More importantly, it renders possibly-explicit content to the user in order to decide
   whether they should be allowed to see it. Self-defeating for this product.

Instead `reviewPage()` fetches the page server-side, extracts up to 8 image URLs (`<img src>`
plus `og:image`), and classifies those. The user never sees the page unless it clears.

The honest tradeoff: a client-rendered page exposes few images to a plain fetch. That
returns **inconclusive** — a third outcome that keeps the block and says so — rather than a
false clear, which was the old flow's failure mode. "Let me through once" covers the case.

#### Verification

40 assertions across domain normalization, keyword false positives, sensitivity profiles,
clean-share maths, the v1→v2 migration and a storage round trip — all passing. Run against
the real `shared/` modules in a VM with a stubbed `chrome.storage`. Static checks confirm no
redeclarations across any of the four script bundles, no dangling references, and that every
manifest and HTML path resolves.

The harness itself is **not** committed — §9.2 kept tests out of this round, and it belongs
in its own commit. It remains the top unbuilt item: the keyword scorer is still the one place
a silent regression is invisible until a user gets wrongly blocked.

#### Not verified

Nothing here has been loaded in Chrome. The service worker, the offscreen document, the
MV3 message routing and every rendered layout are unexercised. Load unpacked and walk:
first-run onboarding → a real block → both escape hatches → the four popup tabs.

---

### 9.5 Test suite — 2026-09-16

§9.2 listed tests as a non-goal for the feature round and §7.4's "detection regex test
harness" had been queued since May. Both are now done, as their own layer.

**`tests/` — 261 assertions, 11 suites, zero dependencies.** `node tests/run.mjs`.
`shared/` modules are evaluated into a fresh V8 context per suite with a stubbed
`chrome.storage` (async callbacks, like the real API) and a frozen clock.

**`tests/MANUAL.md` — 171 checkpoints** across 17 groups, for everything that only exists
inside Chrome: worker lifecycle, offscreen documents, TF.js, message routing, rendering,
performance and the privacy audit. Includes a 10-minute smoke subset and a ranked list of
where the build is most likely to break first.

#### Refactor the tests forced

`getURLScore`, `riskLevel`, `PASSTHROUGH_PARAMS` moved from `content.js` into
`shared/scoring.js`; page-review parsing and verdict logic moved from `background.js` into
`shared/review.js`. Both were unreachable from any test while they sat inside a content
script and a service worker. Writing the tests is what surfaced that.

#### Two real bugs the tests caught

1. **The passthrough-param skip list was being bypassed.** `getURLScore` called
   `getKeywordScore` on the entire raw URL *first*, query string included, and only then
   looped the params to skip `?continue=` and friends. A Google sign-in URL carrying
   `?continue=https://site/porn` scored on "porn" from the full-string pass before the skip
   list ever applied. The Phase 1 fix had looked correct for a year and never worked.
   Now the query string is excluded from the base score and only non-passthrough params are
   added back.

2. **Unrendered template placeholders were queued for fetching.** `{{ image }}` in
   server-rendered HTML resolves as a perfectly valid relative URL, so the appeal's image
   parser treated it as an image to download.

#### And one I introduced

The popup's site card fetched `google.com/s2/favicons` — a remote request keyed by the exact
domain you are looking at, added in the same pass that removed every other remote request
and wrote "no external requests" into the README. Replaced with a local letter mark. The
`static` suite now fails the build if any code assigns a literal `https://` URL to `.src`
or passes one to `fetch`.

#### Still not covered

No end-to-end automation. Puppeteer with `--load-extension` would cover the install,
pause-page, popup and Sites groups cheaply and is the obvious next investment.

---

## 10. Coverage layers as product surface (queued 2026-09-18)

`/deploy` currently tells people to go and set up DNS filtering and OS parental controls
themselves, then never mentions them again. That is honest but inert: the advice is given
once, at the moment someone is least likely to act on it, and nothing afterwards knows
whether they did. The three-layer framing is the most trust-building thing on the site —
it should be a feature, not a paragraph.

### What CleanTab can and cannot do at each layer

An extension cannot configure system DNS, and cannot touch Screen Time, Family Link or
Family Safety. Anything here is **verification and guidance**, never enforcement. Saying
so plainly is the point; the whole reason this section exists is that the competitors
imply total coverage.

| Layer | Configure? | Verify? | How |
|-------|-----------|---------|-----|
| DNS filtering | No | **Yes** | Resolve-time behaviour is observable from the page |
| OS controls | No | No | Manual attestation only |
| CleanTab itself | Yes | Yes | Already known — settings, policy, incognito access |

### 10.1 DNS layer — a real check, not a link

Protective resolvers (NextDNS, Cloudflare for Families on `1.1.1.3`, AdGuard DNS) answer
a blocked domain with `NXDOMAIN` or a sinkhole address. A `fetch()` to a known-blocked
hostname therefore fails differently under a filtering resolver than under an open one,
which is enough to distinguish them without the extension ever loading the content.

Design constraints this has to respect:

- **Never request a real adult domain.** Use the providers' own published test endpoints
  where they exist. A check that pulls a porn hostname to see if it resolves is a worse
  privacy story than the one we are trying to prove, and it would put that hostname in the
  network log of a machine belonging to someone trying to avoid it.
- **This is the only outbound request CleanTab would make that is not user-initiated.**
  It has to be opt-in, run on demand rather than on a schedule, and be declared in the
  privacy policy alongside the appeal fetch. Right now the policy says the appeal is the
  single exception; that sentence changes the day this ships.
- Failure is inconclusive, not "unprotected" — offline looks identical to filtered.

### 10.2 OS layer — attestation, and nothing more

No API exposes Screen Time or Family Link to an extension. The honest version is a
checklist the user ticks themselves, per platform, with links to the right settings pane.
Store the attestation with a timestamp and treat it as what it is: something the user
said, not something we checked. Label it that way in the UI.

### 10.3 The surface: a Coverage panel

A fourth popup tab, or a section in Guard:

```
Layer 1 · Network      Checked · NextDNS responding      [Re-check]
Layer 2 · Device       You confirmed Screen Time is on   [Review]
Layer 3 · This browser Protected · policy detected       
```

Rules for it:

- Three states only — verified, attested, unknown. Never imply verified when attested.
- "Unknown" is the honest default and must not be rendered as a failure.
- A guardian setup (`setupMode: "guardian"`) should surface this immediately after
  onboarding, because that is the user who most needs to hear that one browser is not
  coverage.

### 10.4 Sequencing, and what not to do

Ship order: 10.3 with layer 3 only (already fully known) → 10.2 attestation → 10.1 DNS
check last, because it is the one that changes the privacy claim and therefore needs the
policy page updated in the same release.

**Do not announce any of this on the landing page or in the store listing before it
ships.** The current copy's whole value is that it undersells, and a "coming soon" on a
privacy claim is the fastest way to lose that. It also invites a Web Store reviewer to
ask about network behaviour the extension does not yet have.
