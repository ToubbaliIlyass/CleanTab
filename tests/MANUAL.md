# CleanTab — manual test plan

`node tests/run.mjs` covers the pure logic: scoring, migrations, storage, the ring maths,
appeal verdicts, and structural integrity of the bundle. **261 assertions, 11 suites.**

It cannot reach any of the following, because none of it exists outside Chrome:

- the service worker lifecycle (MV3 terminates it after ~30s idle)
- the offscreen document and TensorFlow.js
- message routing between content script ↔ worker ↔ offscreen ↔ pages
- `chrome.tabs`, `chrome.alarms`, `chrome.idle`
- every rendered pixel

Everything below is that half. Work top to bottom on a **fresh profile** unless a test says
otherwise. Record results in the table at the end.

---

## Setup

```
1. chrome://extensions → Developer mode on → Load unpacked → select the repo root
2. Pin CleanTab to the toolbar
3. Open the service worker console: chrome://extensions → CleanTab → "service worker"
4. Keep that console open for the whole session — most failures surface there first
```

Reset between runs:

```js
// paste in the service worker console
chrome.storage.local.clear(); chrome.storage.session.clear();
// then Reload the extension from chrome://extensions
```

---

## S — Smoke test (10 minutes)

Run this after every change. If any of these fail, stop and fix before continuing.

| # | Step | Expected |
|---|------|----------|
| S1 | Load unpacked | No errors in the service worker console; onboarding tab opens |
| S2 | Complete onboarding | Tab closes; popup opens without errors |
| S3 | Visit `https://en.wikipedia.org/wiki/Camera` | No redirect |
| S4 | Search `https://www.google.com/search?q=porn` | Redirects to the pause page |
| S5 | On the pause page, click "This was wrongly flagged" | Two options appear |
| S6 | Click "Let me through once" | Returns to the original page and stays |
| S7 | Open the popup | Current-site card names the site you're on |
| S8 | Popup → all four tabs | Each renders, nothing overflows 380×560 |

---

## A — Install, upgrade, reinstall

| # | Test | Steps | Expected |
|---|------|-------|----------|
| A1 | Fresh install | Load unpacked on a clean profile | Onboarding opens in a new tab. `chrome.storage.local` has `schemaVersion: 2` |
| A2 | Onboarding step 1 | Read it | Says what CleanTab does *and* that it will get things wrong |
| A3 | Onboarding navigation | Next / Back through all three steps | Dots track position; no step is skippable past an unanswered question |
| A4 | Onboarding completion | Pick a sensitivity + hours → Get started | Tab closes. `sensitivity` and `goalMinutes` are stored |
| A5 | **v1 upgrade** | Before loading: set `chrome.storage.local` to `{schemaVersion:1, safeDomains:["www.old.com","old.com"], today:{date:"<today>",cleanMinutes:40}, totals:{closedDays:9}}`. Reload extension | `trustedSites` has **one** entry `old.com` tagged `appeal-legacy`. `closedDays` still 9. `safeDomains` gone |
| A6 | **v0 upgrade** | Set storage to `{streak:5, redirectsToday:3, safeDomains:["a.com"]}`. Reload | `schemaVersion:2`, `closedDays:4`, `trustedSites:["a.com"]`, legacy keys removed |
| A7 | Reinstall with backup | Export → remove extension → reinstall → onboarding step 1 → "Restore a backup" | Data returns; onboarding closes |
| A8 | Corrupt profile | Set storage to `{schemaVersion:2}` only. Reload | Backfills missing keys, does not crash, popup opens |
| A9 | Double bootstrap | Reload the extension twice quickly | No duplicate trust entries, no reset settings |

---

## B — Detection: true positives

Each should redirect to the pause page. Use **Balanced** sensitivity.

| # | URL / page | Expected reason |
|---|-----------|-----------------|
| B1 | `google.com/search?q=porn` | "Search or link contained high-risk keywords" |
| B2 | `google.com/search?q=nsfw+content` | Same |
| B3 | Any URL with `/porn/` in the path | Same |
| B4 | A known adult domain from `knownAdultDomains` | Redirects; appeal is **permanently** denied |
| B5 | A tube-site clone not on the blocklist, with explicit titles | "Explicit titles detected across page" |
| B6 | YouTube **search** for an explicit term | Redirects (URL score fires) |
| B7 | Reddit post page on an adult sub | "Adult environment + explicit content detected" |

> **B6 note:** YouTube used to return unconditionally, making every YouTube page a blind
> spot. It now drops the *text* signal (the real false-positive source) but keeps URL
> scoring and a raised title bar. Verify a normal video still does **not** trigger (C7).

---

## C — Detection: false positives (regression set)

**None of these may redirect.** This is the set that makes or breaks daily usability — a
blocker that misfires once a day gets uninstalled.

| # | Page | Why it's a trap |
|---|------|-----------------|
| C1 | Google sign-in with `?continue=` | The passthrough param carried the destination's score. *Fixed this pass — verify it holds.* |
| C2 | `en.wikipedia.org/wiki/Camera` | "cam" substring |
| C3 | `en.wikipedia.org/wiki/Essex` | "sex" substring |
| C4 | `en.wikipedia.org/wiki/Sexual_reproduction` | Real word, medical context |
| C5 | `cambridge.org` | "cam" substring |
| C6 | A camera retailer (webcams, "cameras") | "cam"/"cams" everywhere |
| C7 | A normal YouTube video | Must stay unblocked after the YouTube change |
| C8 | Reddit home feed | Feed pages are explicitly exempt |
| C9 | Twitter/X home timeline | Same |
| C10 | A news article *about* porn addiction | Will likely fire on Strict. Acceptable on Strict, **not** on Balanced |
| C11 | A lingerie or swimwear retailer | Classifier bias — check with dwell **on** |
| C12 | An art gallery site with nudes | Expected to misfire; confirm appeal works |
| C13 | Gmail, Google Docs, GitHub, your bank | Must never fire |
| C14 | A page with the word "fuck" in a code comment | Low-weight keyword, needs environment gating |

---

## D — Pause page and escape hatches

| # | Test | Expected |
|---|------|----------|
| D1 | Blocked URL privacy | After a block, check the **address bar** and `chrome://history`. Neither shows the blocked URL — only `chrome-extension://…/redirect.html` |
| D2 | Reason text | Matches why it fired |
| D3 | First-block note | "Pick what fits — only you ever see this." shows once, never again |
| D4 | Reflection chip | Click one → logs, shows a contextual nudge, chips lock |
| D5 | Breathing | "Take a beat" → 3 cycles, Skip works |
| D6 | Escape reveal | "This was wrongly flagged" reveals two options, not before |
| D7 | **Let me through once** | Returns to the page and **stays there** (no redirect loop). Nothing added to Sites |
| D8 | Allowance expiry | Wait 10+ min on that page, reload | Blocks again |
| D9 | Allowance scope | Navigate to a *different* page on the same site | Blocks again |
| D10 | **This site is fine** — safe site | Runs the check, approves, returns you, adds a Sites entry |
| D11 | **This site is fine** — genuinely explicit | **Denied** with a real percentage. Verify in the worker console that it fetched and classified images |
| D12 | **This site is fine** — SPA with no server-rendered images | Says **inconclusive**, keeps the block. Must *not* clear |
| D13 | Blocklisted domain | "This site is fine" is disabled with an explanation |
| D14 | `www` round trip | Block a `www.` site → "This site is fine" → approved | Returns and **stays**. This was the infinite-loop bug |
| D15 | Offline appeal | Turn off network → "This site is fine" | Fails honestly, does not clear |

> **D11 is the most important test in this document.** The previous implementation
> screenshotted CleanTab's own pause page instead of the flagged site, so it approved
> essentially everything. If D11 approves an explicit site, the core promise is broken.

---

## E — Popup: Now tab

| # | Test | Expected |
|---|------|----------|
| E1 | Site identity | Opens on `reddit.com` → card reads `reddit.com` with an "R" letter mark |
| E2 | Three different sites | Three visibly different popups |
| E3 | Protected state | Normal site → green "Protected" + "Scanned Ns ago · risk N of 5" |
| E4 | Risk score | Rises on a borderline page vs a plain one |
| E5 | Restricted page | Open popup on `chrome://extensions` → "Not scanned" + explains why. No Trust/Pause buttons |
| E6 | Trust toggle | "Trust site" → pill flips to "Trusted", tab reloads, no more scanning |
| E7 | Untrust | "Stop trusting" → back to "Protected" |
| E8 | Pause here | → duration options → pick 15 min → "Paused here", resumes in N min |
| E9 | Pause is site-scoped | Another site still shows "Protected" |
| E10 | Resume early | "Resume here" → back to "Protected" |
| E11 | Pause + trusted | Trusted site → Pause button disabled |
| E12 | Ring on a fresh day | Shows `—`, not `0%`, and "No browsing tracked yet today" |
| E13 | Ring with data | Percentage + "N clean of M min browsed" underneath |
| E14 | Ring below the floor | Under 20 browsed min → "N more min to qualify" |
| E15 | Inline insight | Hidden under 10 reflections; shows top trigger after |
| E16 | Layout | Nothing clipped or scrolled off at 380×560 |

---

## F — Popup: Progress

| # | Test | Expected |
|---|------|----------|
| F1 | Heatmap renders | 16 weeks × 7 days |
| F2 | Today's cell | Reflects today's clean share |
| F3 | Untracked days | Blank/pale, **not** dark — an absence, not a bad day |
| F4 | Future cells | Outlined, empty |
| F5 | Tooltips | Hover → "YYYY-MM-DD — N% clean of M min" |
| F6 | Legend | Matches the actual cell colours (this mismatched in a previous version — plan §7.1) |
| F7 | Insights empty | Under 10 reflections → "Patterns appear after 10 reflections." |
| F8 | Insights populated | Seed 10+ reflections → bars sorted desc, percentages sum sensibly |

---

## G — Popup: Sites

| # | Test | Expected |
|---|------|----------|
| G1 | Empty state | Explains what lands here |
| G2 | Manual add | Type `example.com` → Add → appears as "added by you" |
| G3 | Paste a URL | `https://www.example.com/x` → stored as `example.com` |
| G4 | Reject junk | `notadomain` → not added, placeholder hints |
| G5 | Duplicate | Add the same domain twice → one row |
| G6 | Remove | Removes, takes effect on next page load without a reload |
| G7 | Legacy entries | After an A5 upgrade → shows "auto-approved before v0.2 — worth reviewing" |
| G8 | Appeal entries | After D10 → "approved by image check" |
| G9 | Recently blocked | Lists last blocks with domain + reason + age. **No full URLs** |
| G10 | Trust from block list | One tap moves it to trusted |
| G11 | Export | Downloads `cleantab-YYYY-MM-DD.json` |
| G12 | Import | Restores. Reopen popup → data present |
| G13 | Import junk | A random `.json` → "Invalid CleanTab backup file." |
| G14 | **Import is filtered** | Add `{"evil":"x","schemaVersion":2}` to a backup → `evil` is **not** written to storage |

---

## H — Popup: Guard

| # | Test | Expected |
|---|------|----------|
| H1 | Sensitivity renders | Three options, current one selected |
| H2 | Switch to Strict | Persists; a borderline page now blocks that didn't |
| H3 | Switch to Lenient | Image-scanning toggle becomes disabled (profile turns dwell off) |
| H4 | No reload needed | Change sensitivity → next page load uses it |
| H5 | Dwell toggle | Off by default. Turning it on persists |
| H6 | Disable flow | Disable → confirm → passphrase (typed, **paste blocked**) → 1h cooldown |
| H7 | Cooldown countdown | Counts down; "Cancel cooldown" returns to normal |
| H8 | Re-enter → duration | After cooldown → passphrase again → pick 5 min |
| H9 | While disabled | Header badge "Paused"; no redirects anywhere; badge icon dims |
| H10 | Auto re-enable | After 5 min → protection returns **without** opening the popup (this is the alarm path — verify with the popup closed) |
| H11 | Manual enable | "Enable CleanTab" works immediately |
| H12 | Pause nudge | Confirm screen suggests "Pause here" as the lighter option |

---

## I — Clean-minute accounting

The metric the whole ring rests on. Each tick is 1 minute, so these are slow — run them
while doing something else.

| # | Test | Expected |
|---|------|----------|
| I1 | Clean browsing | Sit on a clean page 5 min → `cleanMinutes` +5, `browsedMinutes` +5 |
| I2 | **Idle** | Leave the machine idle 5 min → **neither** counter moves |
| I3 | **Pause page** | Sit on the pause page 5 min → neither moves |
| I4 | **Restricted page** | Sit on `chrome://extensions` 5 min → **neither** moves (no verdict = neutral, not virtuous) |
| I5 | Trusted site | Counts as clean and browsed |
| I6 | After "let me through once" | Counts as **browsed but not clean** |
| I7 | Background tab | Active tab is clean, background tab is not → only the active tab counts |
| I8 | Stale verdict | Leave a tab open >2 min without rescanning → stops counting rather than counting stale |
| I9 | Ring closes | Reach the floor at ≥95% → `ringClosedAt` set, ring says "ring closed" |
| I10 | Closed stays closed | Then browse dirty for 10 min → still closed |
| I11 | Badge arc | Toolbar icon arc tracks the clean share |
| I12 | Badge on pause | Disable → arc goes grey |
| I13 | **Rollover** | Set system clock forward one day → within 30 min the day archives, `closedDays` increments if closed, today resets |
| I14 | Rollover across midnight local | Same, at 23:59 → 00:01 |

---

## J — Image scanning (dwell)

Requires Guard → "Scan images you linger on" **on**, and Balanced or Strict.

| # | Test | Expected |
|---|------|----------|
| J1 | Model loads | Visit Pinterest, linger on an image → worker console shows the offscreen doc created, model loaded, a classification returned |
| J2 | Cold start | First classification < ~5s; later ones much faster |
| J3 | Scroll-past | Scroll a feed fast without stopping → **no** classifications fire |
| J4 | Dwell | Stop on an image 2s+ → one classification fires |
| J5 | Explicit image | Linger on explicit imagery → redirect, reason "Dwelled on flagged image content" |
| J6 | Clean image | Linger on a landscape → no redirect, never re-classified |
| J7 | Small images | Avatars/icons under 180px → never classified |
| J8 | Rate limit | Linger on many images quickly → at most one classification per 3s |
| J9 | **CDN fallback** | On Instagram/X (which reject credential-less fetches) → worker falls back to the content script's canvas encode. Verify it does not silently resolve "safe" |
| J10 | Off-platform | Wikipedia with a large photo → **no** classification fires (not in `VISUAL_PLATFORMS`) |
| J11 | Toggle off | Turn dwell off → no observers, no classifications |
| J12 | Lenient | Switch to Lenient → dwell stops even if the toggle was on |

---

## K — Service worker lifecycle (MV3)

The area most likely to produce bugs the harness can never see.

| # | Test | Expected |
|---|------|----------|
| K1 | **Worker sleeps** | Idle 5 min until the worker shows "inactive" → then load a page | Still scans. Policy round trip wakes the worker |
| K2 | Worker sleeps mid-appeal | Start "This site is fine" → wait | Either completes or fails honestly; never silently approves |
| K3 | Pause page after worker restart | Get blocked → force-stop the worker (chrome://extensions) → reload the pause page | Block context survives (it's in `chrome.storage.session`) or degrades to a generic message |
| K4 | Alarms survive | Force-stop the worker → wait 2 min | Minute tick and rollover alarms still fire |
| K5 | Session cleared on browser restart | Set a site pause → quit Chrome fully → reopen | Pause is **gone** (session-scoped, by design). Trusted sites **remain** |
| K6 | Tab close cleanup | Block a tab, close it | `blockedByTab` / `tabVerdicts` entries for that id are removed |
| K7 | Tab id reuse | Close many tabs, open new ones | No stale verdict leaks into a new tab (would show a wrong risk score) |
| K8 | Offscreen doc created once | Trigger two classifications simultaneously | Console shows **no** "Only a single offscreen document may be created" error |
| K9 | Many tabs | Open 30 tabs at once | No message-port errors; the worker doesn't wedge |
| K10 | Rapid SPA navigation | Click through YouTube/Reddit quickly | Policy refetched per navigation; no runaway message volume |

---

## L — Failure and offline states

| # | Test | Expected |
|---|------|----------|
| L1 | **Fully offline** | Turn off networking entirely → browse | Text detection still works. The whole point of vendoring the model |
| L2 | Offline fonts | Pause page and popup offline | Render in **Bricolage/DM Sans**, not fallback system fonts |
| L3 | Offline badge | Offline with dwell on, trigger a classification failure | Header badge reads **"Text only"**, not "Active" |
| L4 | Corrupt model | Rename `vendor/nsfwjs/model/model.json` → reload → trigger a classification | Badge reads "Text only". Text detection unaffected. No crash loop |
| L5 | Image fetch 403 | Dwell on an Instagram CDN image | Falls back to canvas; if that also fails, reports inconclusive — never "safe" |
| L6 | Page fetch fails during appeal | "This site is fine" on a login-walled page | **Inconclusive**, block held |
| L7 | Storage quota | Fill `chrome.storage.local` near its cap | Degrades without breaking the popup |

---

## M — Windows, profiles, incognito

| # | Test | Expected |
|---|------|----------|
| M1 | Incognito enabled | Allow in incognito → browse | Detection works (manifest is `"incognito": "split"`) |
| M2 | Incognito isolation | Trust a site in normal mode → check incognito | `storage.local` is shared, so trust carries. Session pauses do **not** |
| M3 | Two windows | Popup in window B while window A is focused | Site card describes **the window the popup is in** |
| M4 | Minute tick with two windows | Clean page in A, dirty in B, A focused | Counts A's verdict (`lastFocusedWindow`) |
| M5 | Detached/popup window | Open a site in a popup window | Scans normally |

---

## N — Performance

| # | Test | Method | Threshold |
|---|------|--------|-----------|
| N1 | Idle CPU | DevTools Performance, 60s on a static page | Indistinguishable from extension-disabled |
| N2 | **Infinite feed** | Pinterest, scroll 2 min, dwell **off** | No sustained main-thread cost from the MutationObserver. This was the single biggest cost before the debounce |
| N3 | Feed with dwell on | Same, dwell **on** | CPU elevated but not pegged; page stays responsive |
| N4 | Heavy DOM | A page with 5,000+ images | Scan completes < ~200ms; page not janky |
| N5 | Memory | Task Manager after 10 min of Pinterest with dwell on | Offscreen doc ~100–200 MB (TF.js). Not growing without bound |
| N6 | Scan latency | Time from page load to verdict | < 1s typical; policy round trip is one message |
| N7 | Popup open | Time to interactive | < 200ms |

---

## O — Privacy audit

Run with DevTools → Network on each surface, and with a proxy if you want certainty.

| # | Test | Expected |
|---|------|----------|
| O1 | **Zero outbound requests** | Network tab on the popup, pause page, onboarding, offscreen doc | **No** external requests. Not fonts, not favicons, not the model |
| O2 | Model is local | Offscreen doc network tab | `model.json` + shard load from `chrome-extension://` |
| O3 | No blocked URL in history | `chrome://history` after several blocks | Only `redirect.html` |
| O4 | No full URLs stored | Inspect `chrome.storage.local.blocks` | Domain + reason + timestamp only |
| O5 | Reflections store no URL | Inspect `reflections` | Chip + domain + timestamp only |
| O6 | Export contents | Read the exported JSON | Nothing you wouldn't share; no browsing history |
| O7 | No screenshots | Confirm `captureVisibleTab` appears nowhere in the codebase | Appeals review fetched images, never screen content |

---

## P — Accessibility and polish

| # | Test | Expected |
|---|------|----------|
| P1 | Keyboard | Tab through the popup and pause page | Focus visible, order sensible |
| P2 | Enter to submit | Sites tab → type a domain → Enter | Adds it |
| P3 | Zoom 150% | Popup and pause page | No clipping |
| P4 | Long domain | A very long hostname in the site card | Ellipsis, no overflow |
| P5 | Contrast | Pills and secondary text | Readable |
| P6 | Reduced motion | OS "reduce motion" on | Breathing animation and ring transitions are tolerable |

---

## Where I expect this to break first

Ranked by likelihood, based on what is thinnest:

1. **D12 / J9 — inconclusive paths.** The appeal only sees server-rendered HTML. On
   React/Next sites it will find nothing and return inconclusive constantly. If that turns
   out to be *most* sites, "This site is fine" is close to useless and the design needs
   revisiting — raise `REVIEW_MAX_IMAGES`, or fall back to the content script's live DOM.
2. **K1 / K2 — worker sleep.** Every content-script scan now depends on a message round
   trip. If the worker is slow to wake, the first scan on a cold page may lag.
3. **C11 / C12 — classifier bias.** NSFW.js is general-purpose. Swimwear, lingerie and
   fine art will misfire in both directions. This is a known limit (plan §8.5), not a bug,
   but it determines whether dwell is shippable on by default.
4. **N2 / N5 — feed performance.** The MutationObserver is debounced now, but TF.js in an
   offscreen document that never closes is a real memory cost.
5. **I4 / I8 — verdict freshness.** The 2-minute staleness window is a guess. Too short and
   long reading sessions stop counting; too long and it counts pages you left.
6. **E3 risk score** — `riskLevel` is a normalization of scores that were never designed to
   be a user-facing scale. It may read as noise.

## Not yet covered by anything

- Firefox / Edge (`chrome.*` namespace, offscreen API differs)
- Chrome Web Store review (permission justification for `<all_urls>`)
- Multi-profile sync behaviour
- Any automated end-to-end run — Puppeteer with `--load-extension` would cover A, D, E and
  G cheaply and is the obvious next investment

---

## Results

| Group | Pass | Fail | Notes |
|-------|------|------|-------|
| S — Smoke | / 8 | | |
| A — Install | / 9 | | |
| B — True positives | / 7 | | |
| C — False positives | / 14 | | |
| D — Pause page | / 15 | | |
| E — Popup Now | / 16 | | |
| F — Progress | / 8 | | |
| G — Sites | / 14 | | |
| H — Guard | / 12 | | |
| I — Minutes | / 14 | | |
| J — Dwell | / 12 | | |
| K — Worker | / 10 | | |
| L — Failures | / 7 | | |
| M — Windows | / 5 | | |
| N — Performance | / 7 | | |
| O — Privacy | / 7 | | |
| P — A11y | / 6 | | |
