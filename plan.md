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

---

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

## 9. Contextual nudges on the redirect page (Phase 9 — queued 2026-05-19)

### 9.1 Why
Today's redirect page asks "what's underneath this urge?" via chips. That's the high-leverage interrupt — naming the feeling. But once the user has tapped a chip, the page falls silent. They get a small `.logged` confirmation and that's it. The user wants one more thing: a *reminder of why they installed this*, surfaced contextually based on what they just admitted to feeling.

The constraint that matters: this cannot feel parental. The extension is not telling them what to do; it's reflecting back one concrete fact from data they generated, then offering one related action. One thing per chip, not a menu.

### 9.2 Design rules
- **One nudge per chip.** Not three suggestions. Not a checklist.
- **Pulled from data the extension already has** wherever possible. No new tracking, no new permissions.
- **Tone: observation, not instruction.** "Your ring is at 65%" beats "You should close your ring."
- **Appears after the chip is tapped**, alongside the existing `.logged` confirmation — not before. Reflection comes first, then the soft handoff.
- **Skippable.** The nudge is informational; the user can close the tab without engaging with it.

### 9.3 Chip → nudge mapping

| Chip | Nudge copy | Data source | Optional CTA |
|---|---|---|---|
| **Bored** | "Your ring is at {pct}% — {remaining} min to close today." | `today.cleanMinutes` / `goalMinutes` | none |
| **Stressed** | (UI shift only) Promote the existing "Take a beat" breathing button to primary CTA, larger, with focused styling. | none | "Take a beat" (breathing overlay) |
| **Habit** | "This is your {n}{ordinal} pause today." | `today.redirects` | none |
| **Tired** | After 21:00 local: "It's getting late — your body's tired. Worth closing the laptop?" Before 21:00: "Your body's giving a signal. Step away for 10 min." | `new Date().getHours()` | none |
| **Avoiding** | "You've closed your ring on {totals.closedDays} days. Today's still open." | `totals.closedDays` + today's progress | none |
| **Lonely** | "Loneliness often fuels the scroll. A quick message to someone real lands deeper." | none (one-liner observation) | none |

**Edge cases:**
- First-day install: `closedDays = 0`, `redirects = 0`. The Avoiding nudge becomes "Today is day one. The first ring is the hardest." Habit nudge says "First pause today."
- Goal already closed (`cleanMinutes >= goalMinutes`): Bored nudge becomes "Your ring is closed for today. The work is done."
- After-midnight ambiguity: the Tired branch uses local hours; treat 0:00–4:00 as still "late."

### 9.4 Honest concerns
- **Lonely is the weakest entry** — no data to anchor it. The fallback line is a generic cognitive observation. Alternative considered: skip the nudge entirely on Lonely and keep just the chip confirmation. Going with the one-liner because zero feedback on one chip while others get a contextual nudge feels uneven. Revisit after dogfood.
- **Avoiding** could go in two directions: "you've done this before" (chosen, draws on `closedDays`) vs. "whatever you're avoiding will still be there — start with one small piece." The first is observational, the second is prescriptive. Chose observational to stay consistent with the rest of the page's tone.
- **Habit nudge can sting.** Pulling the literal redirect count surfaces the loop the user is in. That's the point — but it has to land as honest, not punishing. Copy is "{n}th pause" not "{n} relapses." Worth A/B testing tone later.
- **Tired's time branch is a heuristic, not a real fatigue signal.** A user up at 23:00 is not necessarily tired; a user who napped at 14:00 might be. Acceptable: the chip is the user's self-report; we're amplifying their own signal, not making the diagnosis.

### 9.5 Files this will touch
- `redirect/redirect.html` — add a `.nudge-card` element below the chip confirmation, hidden by default.
- `redirect/redirect.css` — style for `.nudge-card` (paper background, small section-label header, body copy). Promoted breathing button variant for Stressed.
- `redirect/redirect.js` — on chip tap, read `today` / `totals` / `goalMinutes` from storage, build the nudge for the tapped chip, render into `.nudge-card`. For Stressed, swap the breathing button into the primary position.

### 9.6 Acceptance criteria
- Tapping any chip shows a nudge below the logged confirmation within ~200ms.
- Each chip produces the correct copy with the correct interpolated numbers.
- Stressed reorganizes the page so the breathing button is the most visually weighted CTA, not just a small link.
- Closing the tab is always possible without touching the nudge.
- A user who has never installed the extension before (zero data) sees the first-day fallback copy, not "NaN%" or "undefined min."

### 9.7 Out of scope for v1
- No multi-step nudge flows.
- No nudge personalization beyond the chip + raw counters.
- No "remind me later" or scheduled re-nudges.
- No tracking of whether the nudge changed user behavior (could be added in Phase 10 if pattern data accumulates).
