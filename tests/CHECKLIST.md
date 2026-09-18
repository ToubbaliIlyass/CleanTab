# CleanTab — release checklist (~45 min)

The short version of [MANUAL.md](MANUAL.md). Every test here is one that can **block the
store submission** or break the core promise. Skipped from the full plan: most popup
layout checks, performance profiling, accessibility, multi-window. Those are polish —
run them from MANUAL.md when you have an afternoon, not before the landing page.

Self-contained: you don't need the long manual open.

---

## Setup

```
1. chrome://extensions → Developer mode on → Load unpacked → repo root
2. Pin CleanTab to the toolbar
3. Open chrome://extensions → CleanTab → "service worker" and keep that console open
   — most failures surface there first
```

Reset between runs (paste in the service worker console, then Reload the extension):

```js
chrome.storage.local.clear(); chrome.storage.session.clear();
```

> **Onboarding caveat.** The onboarding tab only opens when `details.reason === "install"`.
> Reloading an unpacked extension gives `"update"`, so it won't reopen. To retest it,
> remove and re-add the extension, or open
> `chrome-extension://<YOUR_ID>/onboarding/onboarding.html` directly.

---

## 1 — Smoke (10 min) · run first, stop if any fail

| # | Step | Expected | ✓ |
|---|------|----------|---|
| 1.1 | Load unpacked on a clean profile | No console errors; onboarding tab opens; `chrome.storage.local` has `schemaVersion: 2` | |
| 1.2 | Onboarding does not scroll | Resize the window. The page never gets a scrollbar — slides move horizontally. On a short window the visual column drops and the slide scrolls internally rather than breaking | |
| 1.3 | Slide transitions | Next/Back slide right-to-left and back. Progress segments and the N/6 counter track the visible slide | |
| 1.4 | Keyboard | Enter advances, ← goes back. Enter must **not** fire while typing in the partner passphrase fields | |
| 1.5 | Gating | Next is disabled until: step 1 acknowledged, step 2 has a mode, step 3 has a sensitivity, step 5 incognito resolved, step 6 hours picked. Step 4 is skippable unless a partner passphrase was started and left unfinished | |
| 1.6 | **Intent routing — "Myself"** | Step 4 reads "hard to switch off", offers partner passphrase + overnight lock, image scanning stays off | |
| 1.7 | **Intent routing — "Someone I look after"** | Step 4 reads "hard to remove", shows the admin-policy notice with a link to /deploy, and pre-checks image scanning | |
| 1.8 | Partner setup in onboarding | Enter mismatched phrases → error, Next blocked. Matching 8+ char phrases → lock stack shows "Partner holds the key: On" | |
| 1.9 | Live previews | Sensitivity meter fills and its rows change per profile; lock stack ticks as options toggle; ring fills and states the computed minutes | |
| 1.10 | Incognito verification | Opens this extension's row; returning flips the status to green by itself and the mock toggle animates on. Skip also unblocks Next | |
| 1.11 | Completion | Tab closes. Verify `setupMode`, `sensitivity`, `goalMinutes`, `enableDwellDetection`, `partnerLockHash`, `lockWindow` all stored | |
| 1.12 | `https://en.wikipedia.org/wiki/Camera` | No redirect | |
| 1.13 | `google.com/search?q=porn` | Redirects to pause page | |
| 1.14 | Pause page → "This was wrongly flagged" | Two options appear (not before the click) | |
| 1.15 | → "Let me through once" | Returns to the page and **stays** — no redirect loop | |
| 1.16 | Open the popup | Current-site card names the site you're on | |
| 1.17 | Popup → all four tabs | Each renders, nothing clipped at 380×560 | |
| 1.18 | Pause page + onboarding tab icons | Show the CleanTab icon, not a generic globe | |

---

## 2 — False positives · the set that decides whether it gets uninstalled

**None of these may redirect.** Use **Balanced** sensitivity.

| # | Page | Trap | ✓ |
|---|------|------|---|
| 2.1 | Google sign-in with `?continue=` | Passthrough param used to carry the destination's score. Fixed — verify it holds | |
| 2.2 | `en.wikipedia.org/wiki/Essex` | "sex" substring | |
| 2.3 | `en.wikipedia.org/wiki/Sexual_reproduction` | Real word, medical context | |
| 2.4 | A normal YouTube video | YouTube scoring changed this pass | |
| 2.5 | X home timeline (logged out, or a fresh account) | Feed pages are explicitly exempt. **Don't use your own Reddit/X account** — a personalised NSFW-leaning feed tests your account, not the extension | |
| 2.6 | Gmail, GitHub, your bank | Must never fire | |
| 2.7 | **cleantab.acture.co** — your own landing page | Must not redirect. This shipped broken on 2026-09-17: widening text scanning made CleanTab block every page that *discusses* explicit content, starting with its own marketing site | |
| 2.8 | The CleanTab GitHub repo and README | Same class as 2.7 | |
| 2.9 | A news article or study about porn addiction | Must not redirect on Balanced | |
| 2.10 | A recovery resource — NoFap article, a therapist's page on compulsive use | **Must not redirect.** Blocking recovery material is the worst version of this bug: it denies the user the exact content the tool exists to support | |
| 2.11 | A sexual-health page (contraception, STI testing, puberty) | Must not redirect | |
| 2.12 | An art-history page on the nude in classical art | Must not redirect on Balanced | |
| 2.13 | A review or comparison of porn blockers | Must not redirect — commentary about the product category | |

---

## 3 — True positives

| # | Page | Expected | ✓ |
|---|------|----------|---|
| 3.1 | `google.com/search?q=nsfw+content` | "Search or link contained high-risk keywords" | |
| 3.2 | A domain from `knownAdultDomains` | Redirects; "This site is fine" disabled with an explanation | |
| 3.3 | YouTube **search** for an explicit term | Redirects (URL score fires) | |
| 3.4 | YouTube search for `sexy girls naked` | Redirects. Scored 3 against a threshold of 5 before the keyword tier was added — "naked" was not a keyword at all | |
| 3.5 | An **NSFW subreddit listing** page (not a post) | Redirects. Every subreddit listing was previously exempt from title and text scoring, so only raw URL keywords could fire | |
| 3.6 | `reddit.com/r/pornrelapsed/` | Redirects on titles/text, **not** on the URL — `\bporn\b` does not match "pornrelapsed". Recovery subs carry the content they discuss | |
| 3.7 | A tube-site **category or tag page** (not a post) | Redirects. Text scanning now runs on every page shape except an aggregated home feed | |
| 3.8 | Dwell on an explicit image on a site that is **not** Reddit/X/Pinterest/Instagram/Tumblr | Redirects. Image scanning was limited to five hostnames; it now runs everywhere, with a 260px floor off the image-first platforms | |

---

## 4 — Pause page · contains the single most important test

| # | Test | Expected | ✓ |
|---|------|----------|---|
| 4.1 | Blocked URL privacy | Address bar and `chrome://history` show only `redirect.html`, never the blocked URL | |
| 4.2 | Allowance expiry | Wait 10+ min on a let-through page, reload → blocks again | |
| 4.3 | Allowance scope | Navigate to a different page on the same site → blocks again | |
| 4.4 | **"This site is fine" on a genuinely explicit site** | **Denied** with a real percentage. Confirm in the worker console that it fetched and classified *the site's* images. Target: a server-rendered tube site — `xhamster.com` or `spankbang.com` reach the pause page via `knownAdultDomains`, so use a **non-blocklisted** clone (search "free porn tube") whose thumbnails are plain `<img src>` in View Source. **Not Reddit** — see the note below | |
| 4.5 | "This site is fine" on a clean site | Approves, returns you, adds a Sites entry | |
| 4.6 | "This site is fine" on a client-rendered page | Says **inconclusive**, keeps the block. Must not clear. Concrete targets: an `x.com` profile, `instagram.com/<user>`, or new Reddit. Verify first with **View Source** (Cmd+U, not Inspect): if the HTML has no `<img src>` and no `og:image`, the appeal can only find 0–2 images, and `REVIEW_MIN_FOR_CLEAR` is 3, so the only correct answer is inconclusive | |
| 4.7 | `www.` round trip | Trust is stored normalised (`x.com`), but the page you land back on is `www.x.com`. If the trust check doesn't strip `www.`, the site reads as untrusted, rescans, and blocks again — approve, get returned, get blocked, approve, forever. **Test:** get blocked on a URL that begins `https://www.` → "This site is fine" → approve → you must land on the page and **stay** through a manual reload | |

> **Why Reddit is a bad 4.4 target.** A subreddit listing page (`reddit.com/r/<name>/`)
> matches the feed exemption in [content.js:83](../content.js#L83), which disables both
> title detection (rule 2) and the in-post rule (rule 3). Only raw URL keywords can fire
> there. So an NSFW subreddit listing never reaches the pause page in the first place, and
> you can't run an appeal test against a page that was never blocked.

> **4.4 is the one that matters.** A previous build screenshotted CleanTab's own pause page
> instead of the flagged site, so it approved essentially everything. If 4.4 approves an
> explicit site, the core promise is broken and nothing else on this list matters.

---

## 5 — Popup: the paths that touch stored data

| # | Test | Expected | ✓ |
|---|------|----------|---|
| 5.1 | Restricted page (`chrome://extensions`) | "Not scanned" + why. No Trust/Pause buttons | |
| 5.2 | Trust site → untrust | Pill flips, tab reloads, scanning stops then resumes | |
| 5.3 | Pause here, 15 min | "Paused here"; another site still shows "Protected" | |
| 5.4 | Ring on a fresh day | Shows `—`, not `0%`, and "No browsing tracked yet today" | |
| 5.5 | Export | Downloads `cleantab-YYYY-MM-DD.json` | |
| 5.6 | Import that file | Restores; reopen popup → data present | |
| 5.7 | **Import is filtered** | Add `{"evil":"x","schemaVersion":2}` to a backup → `evil` is **not** written to storage | |
| 5.8 | Disable flow | Confirm → passphrase (typed; **paste blocked**) → 1h cooldown → pick 5 min | |
| 5.9 | **Auto re-enable** | After 5 min protection returns **with the popup closed** (alarm path) | |

---

## 6 — Clean-minute accounting · the metric the ring rests on

Each tick is 1 minute. Run these while doing something else.

| # | Test | Expected | ✓ |
|---|------|----------|---|
| 6.1 | Idle 5 min | **Neither** `cleanMinutes` nor `browsedMinutes` moves | |
| 6.2 | 5 min on `chrome://extensions` | Neither moves — no verdict is neutral, not virtuous | |
| 6.3 | Rollover | Set the system clock forward a day → within 30 min the day archives, `closedDays` increments if closed, today resets | |

---

## 7 — Service worker lifecycle (MV3) · likeliest source of invisible bugs

| # | Test | Expected | ✓ |
|---|------|----------|---|
| 7.1 | Idle until the worker shows "inactive", then load a page | Still scans — the policy round trip wakes the worker | |
| 7.2 | Set a site pause → quit Chrome fully → reopen | Pause is **gone** (session-scoped, by design). Trusted sites **remain** | |
| 7.3 | Block a tab, close it | `blockedByTab` / `tabVerdicts` entries for that id are removed | |
| 7.4 | Trigger two classifications at once | **No** "Only a single offscreen document may be created" error | |

---

## 8 — Offline and failure states

| # | Test | Expected | ✓ |
|---|------|----------|---|
| 8.1 | Networking fully off, browse | Text detection still works — the whole point of vendoring the model | |
| 8.2 | Pause page + popup offline | Render in **Bricolage/DM Sans**, not fallback system fonts | |
| 8.3 | Rename `vendor/nsfwjs/model/model.json`, reload, trigger a classification | Badge reads "Text only". Text detection unaffected. No crash loop | |
| 8.4 | Offline → "This site is fine" | Fails honestly, does not clear the block | |

---

## 9 — Privacy audit · every claim the landing page makes

Run with DevTools → Network open on each surface. **These are the store-review answers.**

| # | Test | Expected | ✓ |
|---|------|----------|---|
| 9.1 | **Zero outbound requests** from popup, pause page, onboarding, offscreen doc | No external requests. Not fonts, not favicons, not the model | |
| 9.1b | Appeal fetch is the one exception | Pressing "This site is fine" fetches the appealed page and its images **from that site**, credentials omitted. Confirm nothing goes anywhere else — this is the one network behaviour the privacy policy has to declare | |
| 9.2 | Offscreen doc network tab | `model.json` + shards load from `chrome-extension://` | |
| 9.3 | `chrome://history` after several blocks | Only `redirect.html` | |
| 9.4 | Inspect `chrome.storage.local.blocks` and `reflections` | Domain + reason + timestamp only. No full URLs | |
| 9.5 | `grep -rn captureVisibleTab .` | No hits — appeals fetch images, never screen content | |

---

## 10 — Image scanning (dwell) · only if shipping it on

Requires Guard → "Scan images you linger on" **on**, Balanced or Strict.

| # | Test | Expected | ✓ |
|---|------|----------|---|
| 10.1 | Stop on an image 2s+ on Pinterest | One classification fires; console shows offscreen doc + model load | |
| 10.2 | Scroll a feed fast without stopping | **No** classifications | |
| 10.3 | Linger on explicit imagery | Redirect, reason "Dwelled on flagged image content" | |
| 10.4 | Instagram/X image (credential-less fetch is rejected) | Falls back to the content script's canvas encode; never silently resolves "safe" | |
| 10.5 | Lingerie/swimwear retailer, art gallery with nudes | Known classifier bias. If it misfires, confirm the appeal works — then decide whether dwell ships off by default | |

---

## 11 — Lock strength

New this pass. Group 5 covers the old flat-hour disable flow; this covers what replaced it.

| # | Test | Expected | ✓ |
|---|------|----------|---|
| 11.1 | Escalating cooldown | Disable once → next confirm screen says **2-hour**, then 4, then 8, capping at 24. Guard tab's Protection text states the next wait before you start | |
| 11.2 | Escalation decays | Hand-edit a `disableEvents` timestamp to 8 days ago, reopen → back to 1 hour | |
| 11.3 | Partner setup | Guard → Accountability partner → Set up. Save is disabled until both fields match and are 8+ chars | |
| 11.4 | Partner gate | With a partner set, Disable asks for **their** passphrase first, before any cooldown is spent. Wrong phrase clears the field and says so | |
| 11.5 | Partner phrase is not stored | Inspect `chrome.storage.local` → `partnerLockHash` is 64 hex chars, and the phrase does not appear anywhere | |
| 11.6 | Partner paste is blocked | Try to paste into the partner field → refused, same as the main passphrase | |
| 11.7 | Partner removal needs the partner | Set up → press Remove → it asks for the passphrase rather than just deleting it | |
| 11.8 | Lock window on | Set 10pm–6am. Guard reads "No off switch between 10pm–6am" | |
| 11.9 | **Lock window enforced** | Set a window covering *now* → Disable shows "Outside your unlock hours" with the range, and no cooldown starts | |
| 11.10 | Can't escape the window from inside | During an active window, try to toggle it off or change the hours → refused with an explanation | |
| 11.11 | Window wraps midnight | A 10pm–6am window is active at 11pm **and** at 2am, inactive at noon | |
| 11.12 | Escape hatch still works | With a partner lock, a lock window active, and a managed policy in place, a blocked page still lets you through with one click. **This is the rule the whole design rests on** | |

---

## 12 — Managed policy (enterprise install)

Set a policy locally to test: on macOS `defaults write com.google.Chrome 3rdparty '{"extensions":{"<id>":{"policy":{...}}}}'`, or use the generator at `/deploy`. Verify at `chrome://policy`.

| # | Test | Expected | ✓ |
|---|------|----------|---|
| 12.1 | Managed sensitivity | Set `sensitivity: "strict"` → Guard shows it selected, the options are **disabled**, and a note names the administrator | |
| 12.2 | Policy governs detection, not just UI | With managed strict, a borderline page blocks that didn't on balanced. This is the one that proves the merge reaches `getTabPolicy` | |
| 12.3 | `allowDisable: false` | Disable button is disabled, and pressing it shows "Locked by your administrator" | |
| 12.4 | Disable in flight is overridden | Disable for 30 min, then apply `allowDisable: false` → protection resumes immediately | |
| 12.5 | `allowAppeals: false` | "This site is fine" is hidden on the pause page, and the handler refuses it even if invoked | |
| 12.6 | `lockedTrustedSites` | Listed domains are trusted, and do not appear as removable in the Sites tab | |
| 12.7 | No policy set | Everything behaves exactly as before, no managed note anywhere. `chrome.storage.managed` being empty must never break the popup | |
| 12.8 | Force-install | Install via the generated config → CleanTab cannot be removed or toggled at `chrome://extensions` | |
| 12.9 | Incognito bypass is closed | With `IncognitoModeAvailability: 1`, incognito is unavailable — the five-second bypass of everything above | |

---

## Results

| Group | Pass | Fail | Notes |
|-------|------|------|-------|
| 1 — Smoke | / 18 | | |
| 2 — False positives | **6** / 13 | 0 | 2.1–2.6 passed 2026-09-17; 2.7–2.13 added 2026-09-18 after the discussion-vs-hosting regression and are UNRUN. Originally passed after text scanning widened to all non-feed pages, image scanning widened to all sites, and the keyword list grew to 45 entries |
| 3 — True positives | / 8 | | |
| 4 — Pause page | / 7 | | |
| 5 — Popup data | / 9 | | |
| 6 — Minutes | / 3 | | |
| 7 — Worker | / 4 | | |
| 8 — Failures | / 4 | | |
| 9 — Privacy | / 6 | | |
| 10 — Dwell | / 5 | | |
| 11 — Lock strength | / 12 | | |
| 12 — Managed policy | / 9 | | |

**100 tests.** A clean run on 1–9 plus a decision on 10 is enough to submit; 11 and 12 gate the hardening claims on the /deploy page.

---

## Still blocking the store after this passes

- ~~No privacy policy page~~ — **done.** `/privacy` is a real route in CleanTab-Landing
  (`src/app/privacy/page.tsx`), in the sitemap, and linked from the footer. Group 9 above
  is the evidence for every sentence on it; test 9.1b is the one claim that needed care.
  Submit `https://cleantab.acture.co/privacy` as the store's privacy policy URL.
- ~~Vendored licenses~~ — **done.** `LICENSE` (MIT) and `THIRD-PARTY-NOTICES.md`
  (nsfwjs MIT, TensorFlow.js Apache-2.0, both fonts OFL) are in the repo. The landing
  page claimed "MIT licensed" with no licence file behind it until now.
- ~~Permission justification~~ — drafted. The "Permissions, and why each one is needed"
  section of `/privacy` is written to be pasted into the submission form.
- **Bump `manifest.json` version from `0.2`** — still open.
- ~~Group 2 against the widened detection~~ — **passed 2026-09-17.** The hardening work
  and the /deploy page are no longer gated on it. Worth re-running the fuller 14-case set
  in MANUAL.md §C before any further loosening of the environment gate.
- **Store screenshots + promo tile** — still open. 1280×800 or 640×400; the pause page,
  the Now tab with a filled ring, the Progress heatmap and the Guard tab are the four
  that show the product.
- **Add `public/og.png` (1200×630)** — the metadata entry is written and commented out in
  `src/app/layout.tsx`; uncomment it once the image exists.
- **Commit and tag** both repos. The working tree is large and uncommitted.
