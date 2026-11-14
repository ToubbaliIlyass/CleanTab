# CleanTab product audit

Report only; no code changed. Scope: speed, ease of use, delight, retention psychology, gaps vs. comparable tools. Effort S/M/L = days/weeks/month-ish for one dev. "Measured" means I ran it; "estimate" means I did not.

## Top 10: do first

| # | Do | Effort | Impact | Backfire risk |
|---|----|--------|--------|---------------|
| 1 | **Make the ring measure something real.** Today it is near-tautological (see 3.1). Replace or supplement with "protected days" and "pauses that ended with you leaving". | M | High | Low |
| 2 | **Inject the content script into already-open tabs on install/update** (`chrome.scripting.executeScript`; needs the `scripting` permission). Right now protection silently does not exist in open tabs until reload. | S | High (first-day trust) | Low |
| 3 | **Forgiving streak: "N of the last 14 days", never a consecutive counter that resets to 0**, plus a post-slip message (4.3). | S | High | Low if copy is right |
| 4 | **Fix the pause-page nudge that contradicts the popup ring** ("Your ring is at 40% - 70 min to close" uses `goalMinutes`; the ring uses clean share). Also drop the onboarding "hours per day" step or make it do something. | S | Medium (trust, one fewer step) | None |
| 5 | **Instant block for known domains via declarativeNetRequest** (redirect to the pause page before any content loads) and a URL-only check at `document_start`. Today the scan waits for `load`. | M | High (latency, no flash of content) | Medium: needs careful rules and tests |
| 6 | **Rewrite the reflect prompt** (4.2): add "Not sure / just curious", drop "actually", make chips optional and second-person-neutral, add an if-then plan. | S | Medium | Low |
| 7 | **Let users block a site/keyword themselves** ("Block this site" in the popup site card). The only false-negative recourse today is none. | S-M | High | Low |
| 8 | **Lower the cost of the first escape hatch, keep the last one expensive.** Add a short, cheap "pause 10 min" with a 30 s wait; keep hour-plus cooldowns for "off". Strict-only systems push people to uninstall, which has zero friction. | S | High (retention) | Medium: define limits |
| 9 | **Weekly recap, local and optional**, shareable as text the user copies (partner view without a server). | M | Medium-High | Low |
| 10 | **Close the offscreen document after ~5 idle minutes and log model load/inference timings** into `getHealth`. | S | Medium (memory) | Low |

## 1. Performance

### Measured
- Vendored size: `vendor/nsfwjs/nsfwjs.min.js` 2.6 MB (about 0.47 MB gzipped; the extension is zipped in the Web Store, but Chrome unpacks it so parse cost is for the full 2.6 MB) + model weights 2.6 MB + fonts 260 KB (+ the ~100 KB of new Gabarito/Caveat/DM Mono, loaded only on extension pages). Extension total roughly 5.5 MB.
- Content script payload per page: `content.js` 20 KB + shared files about 25 KB = ~45 KB parsed on every page, every tab. Negligible. The service worker imports 14 files, ~78 KB. Negligible.
- `getEnvironmentScore()` (`content.js`) reads `innerText` on `h1,h2,h3,a,button,span,label`. Synthetic benchmark in headless Chromium on a flat DOM: 1,500 elements 26 ms (first call includes layout), 9,000 elements 9 ms, 30,000 elements 28 ms. `textContent` was 2-3x faster (2-12 ms). `document.body.innerText` once: 0.1-2.7 ms. So it is not a disaster on simple DOMs; on real pages with complex CSS, `innerText` costs more (estimate 2-10x). Not the first thing to fix, but the whole page scan is cheap enough that **re-scanning on large DOM growth is affordable** (see below).

### Estimated, not measured (measure first: add `performance.now()` around model load and first/steady inference in `offscreen.js`)
- First image classification pays: create offscreen doc, parse 2.6 MB JS, fetch and decode 2.6 MB weights, TF backend init and warm-up. Likely 1-3 s cold. Steady-state inference on WebGL is probably tens to low hundreds of ms.
- End-to-end dwell latency is dominated by design constants, not the model: `DWELL_MS` 2 s + up to `CLASSIFY_RATE_MS` 3 s + SW fetch + inference. A flagged image can be on screen 3-6 s before the redirect, and only one image per 3 s is classified, so a feed of 20 images is mostly unchecked.
- Offscreen document is never closed (`ensureOffscreenDoc`); TF memory plus a WebGL context stay resident for the browser session. Likely tens of MB to 100+ MB (estimate).
- Every page load wakes the service worker (`getTabPolicy`: 5 sequential storage reads, 2 session reads, managed read). Cheap individually, but it also resets the 30 s idle timer, so the worker is rarely asleep while browsing. Parallelise with `Promise.all`; cache policy in `storage.session` keyed by domain.

### Detection latency (the user-visible one)
- `content.js` `init()` waits for `window load` (fallback 1.5 s). On a slow page the user sees content for as long as load takes. URL-only rules need no DOM and could fire at `document_start`.
- Text is scanned once per URL. Content loaded later (infinite scroll, chat, lazy sections) is never rescanned unless the URL changes: a clear false-negative class.

### Fixes ranked by gain/effort
1. (S) Cache policy; parallelise reads in `getTabPolicy`.
2. (S) Close offscreen after idle; add timing telemetry to local health (stays on device).
3. (S) `textContent` and an element cap in `getEnvironmentScore`; verify on 5 real pages first.
4. (S-M) Rescan when `document.body` text grows more than ~50% or on a throttled `MutationObserver` (only while the tab is visible).
5. (M) DNR redirect for `knownAdultDomains` plus `document_start` URL check: removes the flash for the most common case.
6. (M) Prioritise dwell queue by image size/position, not "latest wins" (`dwellClassifyQueued` keeps only one src, dropping the rest).
7. (L) Smaller/quantised model or lazy-load only after the first dwell candidate; only worth it if measurement shows the cold start hurts.

## 2. Ease of use

### First run
- Flow: install -> `onboarding.html` -> 6 steps (welcome + acknowledge, intent, sensitivity, lock, incognito, "day") -> done. Six steps with a gate on each is long for a tool whose value moment ("it caught something") may be days away. Time-to-first-value is not measured anywhere.
- The "day" step asks hours of browsing per day and turns it into `goalMinutes`, which now only feeds the pause-page nudge text, and that text contradicts the popup (3.1). Cut or repurpose it. Dropping it gives five steps.
- Incognito step: granting access reloads the extension and can close the onboarding tab; the resume hook handles that, which is good, but it is the most fragile moment of the funnel. Make it skippable with "do this later" and a popup reminder.
- Defaults: sensitivity balanced (reasonable). Image scanning off for "self" mode, on for guardian. That is the single biggest detection lever (text rules miss image sites entirely) and it ships off for the main audience. Reconsider: default on with a clear "costs some battery" line, or ask at the sensitivity step (it already sits there).
- No "see it work" moment. Add a harmless built-in test page ("Try a pause") that triggers the real redirect so users see the pause screen once, in a safe context, before they meet it by accident. Also confirms the install works. (S-M)
- **Existing tabs are unprotected after install/update** (no `scripting` injection). A user who installs and tests on the tab they already had open sees nothing happen. Top-3 fix.

### Settings and popup
- Popup has 4 tabs (Now, Progress, Sites, Guard). Now-tab hierarchy puts the current-site card above the ring; the emotional core (progress) is pushed down. For the first 7 days consider ring first, site card collapsed.
- "Closed days", "Blocks today", "Reflections" on the stats row: "Blocks today" as a headline number reads as a failure counter. Consider "Pauses today" with neutral styling.
- Empty states: "Patterns appear after 10 reflections" is the only guidance in Progress; the heatmap is empty-looking for new users. Add "Day 1" framing and a sample-free skeleton.
- Errors: the popup swallows messaging errors (`void chrome.runtime.lastError`) and shows the "Text only" badge only when the model fails; no state for "this tab was never scanned" beyond the pill. Make "Not scanned (browser page)" explicit.

### False positives / negatives / appeals
- One-time pass is cheap (good), capped at 3/domain/day (good, explained).
- "This site is fine" appeal fetches the page and needs >=3 classifiable images; client-rendered sites return "inconclusive" often. That is the commonest legitimate case (news, forums) and it dead-ends. Offer, after inconclusive: "Let me through once" (exists), plus a time-limited trust (e.g. 7 days, `expiresAt` already exists in the trust schema) without image proof, with the partner phrase if a partner lock exists.
- No false-negative path: add "Block this page/site" and a personal keyword list (Top-10 #7).
- Count false positives (one-time passes per domain) and, after the 2nd, suggest trust once; stops the nag-then-disable loop.

### Accountability partner
- Today the partner chooses a passphrase on the same device ("They type it now and keep it"). Works only if the partner is physically present, and the partner never sees anything afterwards. For the user it is a wall; for the partner it is a one-time chore with no ongoing role, so the relationship decays.
- Serverless remote option: shared secret set at setup; the partner's phone (a static page or a copy/paste code) produces a time-boxed HMAC code the extension verifies locally. No server, fits the privacy claims. (M-L)
- Give the partner something to look at without surveillance: the user-initiated weekly summary (counts only, no URLs; `blocks` already stores domain only). Be honest: this is weaker than Covenant Eyes by design.
- Say clearly that the partner cannot see browsing, to keep trust.

### Autonomy / friction
- The strongest "off" path (uninstall, or disabling the extension in `chrome://extensions`) cannot be gated by an extension. Strict UI friction therefore only shifts people to the zero-friction exit. Keep cooldowns, but make the cheap escapes (pause 10 min, one-time pass) genuinely cheap; escalation to 24 h (`COOLDOWN_MAX_MS`) after 4 disables a week is the point where reactance is likely (4.4).
- Guardian installs: managed policy exists (`managed_schema.json`); document the Chrome policy route for forced installs on the landing site.

### Accessibility (after restyle)
- Done: focus rings, reduced motion, aria on tabs/status. Remaining: the breathing overlay is purely visual (add `aria-live` text, already textual; confirm skip is first in tab order), popup is fixed 380x560 so browser zoom clips content (use `min-height`), `alert()` in import blocks screen readers poorly, heatmap cells have no text equivalent (add a visually hidden summary: "N of last 16 weeks days protected").

## 3. Fun and delight (truthful measures only)

### 3.1 What can the extension truthfully measure?
Real: blocks, pauses taken, reflection chips picked, one-time passes used, trusted sites added, minutes on scanned pages, time protection was disabled, days with protection on throughout, breathing exercise completed.
Not real: "urges resisted", "content avoided", "days clean" in a moral sense. It cannot see other browsers, devices, apps, or Incognito if not enabled. Do not claim these.

**Skeptical finding on the ring.** Ring = clean minutes / browsed minutes on scanned tabs (`tickMinute`). A flagged page is redirected within a second and the pause page never ticks, so the only "unclean" minutes come from one-time passes (`allowed` reports `clean=false`). A normal user who browses 20+ minutes sits at ~100% every day: the ring closes without the user doing anything, which is neither motivating nor informative, and it hides the thing that is informative (how often they were stopped and what they did next). Meanwhile the pause-page nudge talks about "minutes to close" (`goalMinutes`), a different model. Pick one story.

### 3.2 Ideas that fit
- **Protected day** = protection on all day, no pass-through used, no disable. Ring closes on that, not on minutes. (M, ties to Top-10 #1)
- **Heatmap** (`renderHeatmap`): colour by outcome (sage = protected, butter = pass-through used, blush = paused/off), not a gradient of share. Tooltip text per cell for accessibility. (S)
- **Plant**: already tied to the ring state; tie growth to *days protected this week* so it grows across days, with wilting never shown (rest state = bare pot, never "dead"). (S)
- **Milestones, quiet**: 7, 30, 100 protected days; first reflection logged; first time you left the pause page without a pass. One small sticker each, no sound, shown once. (S)
- **Celebration on the right event**: when a pause ends with the tab closed or navigated away (measurable via `tabs.onRemoved`/URL change after redirect) show "Nice - you left." Variable, small, optional. (M)
- **Weekly recap** (Sunday popup card): pauses, reflections by chip, protected days, time-of-day pattern ("most pauses 11pm-1am") with an if-then suggestion (4.1). (M)
- **Themes**: optional palette swap (sage/sky/lilac) and plant species; cosmetic only, local. (S)
- Avoid: points, badges for blocks (rewarding triggers), leaderboards, share-to-social prompts (outing risk).

## 4. Retention psychology (ethical)

For each: support / maps to code / build / effort / backfire risk. Sources I am confident of are named; **[uncertain]** marks ones to verify before citing publicly.

### 4.1 Implementation intentions (if-then plans)
- Support: Gollwitzer 1999 (American Psychologist); meta-analysis Gollwitzer & Sheeran 2006 (medium-to-large effect on goal attainment).
- Maps to: `redirect.js` chips and `buildNudge`; `redirect.html` first-note.
- Build: after a chip, offer one optional plan: "Next time I feel [chip], I will [stand up / text a friend / 10 slow breaths]". Store locally; show the user's own plan on the next pause, with the time-of-day pattern from the recap. (M)
- Risk: low; make it optional and one tap, or it becomes homework.

### 4.2 The pause and the reflect prompt (urge surfing, affect labelling)
- Support: urge surfing, Marlatt and colleagues, Bowen & Marlatt 2009 (smoking) **[urge-surfing for porn specifically: limited evidence]**; affect labelling, Lieberman et al. 2007 (Psychological Science): naming emotion dampens amygdala response. A short, forced delay reduces impulsive use: the "one sec" intervention studies (Grüning et al.) **[uncertain: check citation and effect sizes]**.
- Current wording audit (`redirect.html`):
  - "What's actually going on right now?" - "actually" can read as accusatory; "right now" is good.
  - Chips Bored / Stressed / Habit / Avoiding something / Lonely / Tired: good, emotion-labelling and non-judgemental. Missing: "Curious", "Not sure", "Just testing", and a positive option ("Something else"). Forcing a label can feel like a quiz; allow skipping.
  - Nudges: "Loneliness often fuels the scroll" presumes the habit; "Take a moment to breathe" fine; "Today is day one. The first ring is the hardest." fine. "This is your 3rd pause today" is neutral but can read as counting failures; consider omitting for repeat counts.
  - Breathing 4-4-4 x3 = 36 s: reasonable and optional; offer "1 minute" and "skip" equally.
  - Suggested: "Pause. What's going on right now? (optional)" with chips + "Not sure". After a chip, a single line plus two actions: "Take a beat" / "Close this tab".
- Build: copy change (S); "Close this tab" button and a measurable "left" outcome (S-M).
- Risk: low. Not shaming is the whole point: keep the headline "Pause." and never say "caught".

### 4.3 Self-compassion after a slip (abstinence violation effect)
- Support: Marlatt & Gordon 1985 relapse prevention (AVE: a lapse plus self-blame turns a slip into a binge); Breines & Chen 2012 (self-compassion after failure increases motivation to improve); Neff's self-compassion work. Porn-specific: Grubbs et al. on moral incongruence and perceived addiction **[fairly confident; verify before quoting]**: shame correlates with worse outcomes, not better.
- Maps to: ring reset daily; `allowOnce`; disable flow; popup Now tab.
- Build: when the user uses a pass-through, turns protection off, or the ring "opens": a calm, single message ("That happens. One day isn't the pattern. Want a plan for tonight?"), no red, no count. Show the 14-day view, not a streak of zero. (S)
- Risk: none if copy is warm and short; backfires if it is long or therapeutic-sounding.

### 4.4 Friction design, commitment devices, reactance
- Support: Ulysses contracts / precommitment; Ariely & Wertenbroch 2002 (self-imposed deadlines help, imperfectly); Brehm 1966 reactance (restricting freedom increases desire for the restricted option); autonomy support, Deci & Ryan self-determination theory.
- Maps to: `shared/lock.js` (1 h base cooldown doubling to 24 h within 7 days, lock window, partner phrase).
- Observations: good that friction is on *disabling*, not on *escaping a false positive*. Risks: a 24 h wait after repeated disables is a cliff; the uninstall route stays free. Add a tier: short pause (10 min) with 30 s delay and a "why?" chip; require the long cooldown only for "off". Let the user *choose* their lock level in settings, with a calm default; people keep what they chose. (S)
- Risk: medium; each concession weakens the commitment. Log all pauses locally so the user can see their own pattern.

### 4.5 Streaks, loss aversion, forgiveness
- Support: Kahneman & Tversky loss aversion explains why streaks motivate; but a reset after a long streak is a classic AVE trigger ("what the hell effect", Polivy & Herman). Duolingo-style freezes/repair are the common mitigation [pattern, no peer-reviewed source I can cite]. Over-justification (Lepper, Greene & Nisbett 1973) warns against rewarding what should become intrinsic.
- `plan.md` already decided "No streak metaphor": sound for the shame risk, but it leaves users without a "keep going" hook.
- Build: "N of the last 14/30 days" (never resets), "longest run" shown only as a past best, no consecutive counter; if a day is missed show "welcome back" not "streak lost". (S)
- Risk: low.

### 4.6 Identity-based habits
- Support: Bryan, Walton, Rogers & Dweck 2011 (noun framing "be a voter" vs "vote" increased turnout); Clear (popular, not research).
- Build: onboarding and recap copy as identity ("You're someone who pauses" rather than "You blocked 12 things"); an optional one-line "why I'm doing this" the user writes in onboarding and sees on the pause page. (S) Highly personal; local only.
- Risk: low-medium; do not mirror it back during a slip in a way that feels like a scolding.

### 4.7 Variable vs predictable rewards
- Support: Skinner variable-ratio schedules drive compulsive engagement (slots, feeds). For a tool whose goal is *less* compulsion, avoid them as a primary mechanic.
- Build: predictable rewards only (the ring/plant/weekly recap on a fixed day); a *rare* small surprise (a new plant species at 30 protected days) is fine. No random loot, no "spin".
- Risk: high if you copy engagement mechanics; the product's credibility is that it is the opposite of those.

### 4.8 Defaults and the first 7/30 days
- Support: defaults, Johnson & Goldstein 2003 (organ donation); Thaler & Sunstein; fresh-start effect, Dai, Milkman & Riis 2014 (Mondays, month starts, birthdays); habit formation timelines vary widely, Lally et al. 2010 (median ~66 days; wide range).
- Reality: most installs of utility apps drop within days (general pattern; I will not quote a number). Make days 1-7 count: day 1 "try a pause" demo, day 2 "your first reflection", day 3 tip about the lock, day 7 first recap, day 30 identity milestone. All local, triggered by popup opens, **never push notifications**.
- Re-engagement without guilt: if the user has not opened the popup in 14 days, show one welcome-back card; no "we miss you" emails (no accounts exist anyway).
- Fresh-start prompts: on Monday/1st of month, offer to revisit sensitivity and the lock (S).

### 4.9 Accountability dynamics
- Support: accountability and social support improve adherence (general addiction-recovery literature; Covenant Eyes' model; details **[uncertain: no specific citation]**). Surveillance-style reporting can breed secrecy and resentment.
- Build: as in section 2 (summary the user shares). Add a "tell my partner I changed settings" prompt at lock removal, not automatic reporting. (M)

### 4.10 Privacy trust as a retention feature
- Strength: no server, no accounts. Keep claims accurate (fixed after the first audit). Show "What CleanTab stores" in the Guard tab (the export JSON already exists); a "delete everything" button; the blocks log keeps domains only (good).
- Risk: the optional uninstall survey (`chrome.runtime.setUninstallURL`) is the one place a network call would help learning; make it a plain link to a site page, disclosed.

## 5. What comparable tools do (ideas only) and honest differentiation

| Tool | Idea worth considering | Fit |
|------|------------------------|-----|
| one sec | Forced short delay + breathing before opening an app; "intention" prompt | Already close (pause page). Add the "why am I here?" intention at the *pause*, not on all sites. |
| Opal / Freedom / Cold Turkey | Schedules, focus sessions, hard blocklists | Missing: user blocklist, schedules (night mode). The lock window exists; add a *block-all-flagged-categories-at-night* scheduled strict mode. |
| Brainbuddy / Quittr | Daily check-ins, progress milestones, community | Check-ins fit (chips). Skip community (privacy, moderation). Quittr-style day counters are the shame risk; use 14-of-30 instead. |
| Covenant Eyes / Fortify | Partner reports, screenshots, education | Differentiate honestly: **no surveillance, no server**. Offer the user-controlled summary only. |
| Cold Turkey Blocker | Hard to bypass | Not achievable in an extension; say so on the landing page. Do not market it as unbreakable. |
| SafeSearch tools | Force SafeSearch / YouTube restricted mode | Missing and cheap: DNR header rules for Google/Bing/YouTube (M). High value, low false-positive cost. |

Missing, ranked: (1) user blocklist/keywords, (2) SafeSearch/Restricted Mode enforcement, (3) scheduled strict hours, (4) injection into open tabs, (5) cross-device/other-browser story (say so plainly: one browser profile only), (6) a lighter "pause 10 min".

Differentiation that is true: on-device detection, no accounts, non-shaming reflect step, honest false-positive paths, managed-policy support for guardians and schools. Weakness to state, not hide: easily removed by anyone who wants to, and covers one browser.

## Caveats
- No users, analytics or real-device profiling were available. All retention claims are hypotheses to test; instrument locally (counts only) and review via the existing export before changing mechanics.
- Citations are from memory; verify years and findings before publishing any of them.

## Status after implementation

Built (see WHAT-CHANGED.md): protected-days model across ring, plant, heatmap, badge arc and pause nudges (with lazy interpretation of old stored days, no data rewritten); forgiving "N of last 14" plus best-run record and 7/30/100 milestones; compassionate post-slip card; welcome-back card; once-a-day celebration toast with confetti (reduced-motion safe); injection into already-open tabs (`scripting` permission); 10-minute quick pause (30 s breather, 3/day, lock-respecting, logged); user blocklist (popup Sites tab and site card) and subdomain matching; built-in adult-site list and blocklist acted on at `document_start`; reflect prompt rewrite (optional, "Just curious", "Not sure", "Close this and move on", if-then plans); practice pause in onboarding, default Balanced, hours question removed; weekly recap with copy-to-clipboard; rescan on large DOM growth; element cap in scoring; policy reads in parallel; offscreen document closes after 5 idle minutes; onboarding layout rebuilt to fit the viewport.

### Not built, why
- **declarativeNetRequest redirect for known adult domains.** A DNR redirect loses the original URL, so "Let me through once" cannot work, or the domain must go into the pause page's URL (browser history), which the project decided against. I chose the conservative route: the same lists are checked at `document_start` in the content script. Revisit if the flash of content proves to matter.
- **SafeSearch / YouTube Restricted Mode enforcement.** Header rules can break sign-in and are a Web Store policy question; needs a product decision.
- **Serverless remote partner codes (HMAC).** A security design (secret exchange, clock skew, recovery) that deserves its own review, not a patch.
- **Image scanning on by default.** Battery and false-positive trade-off needs real measurements first.
- **Scheduled strict hours** beyond the existing lock window; **optional themes**; **fresh-start (Monday) prompts**; **time-limited trust after an inconclusive appeal**; **dwell-queue prioritisation**. All small, none clearly better than the above; defer until usage data exists.
- **Cross-context write races** (popup vs worker) remain; would need all writes routed through the worker.
- **Focus-aware minute counting**, **uninstall survey URL** (adds a network call): product decisions.
- **Real-Chrome verification.** Pages were rendered with a chrome.* stub. The injection, `document_start` early block, offscreen idle close and quick pause countdown need the manual checks added to tests/MANUAL.md style before release.

## False-positive pass

Corpus: `tests/corpus.mjs` (155 benign pages, 21 flagged; synthetic and non-explicit), run by `tests/corpus.test.mjs`. Before (original logic): balanced 24/155 false positives (15.5%), 17/21 flagged caught (the other 4 were known-adult domains, which only the later domain list handled); strict 65/155 (42%); lenient 3/155. After: balanced 0/155, 21/21 caught; strict 12/155 (7.7%, all single-medium-word searches); lenient 0/155.

Root causes: (1) the environment score added +3 per element, so any long page, a shop with "Nude" shade links, or a forum with NSFW tags, climbed past the threshold just by length; (2) weak words (sexy, bikini, cam, escort, tits) summed to a block in queries (x1.5); (3) ambiguous words weighted as explicit (hardcore, fingering, orgy at 5); (4) a topic in the URL path blocked on its own; (5) strict's URL threshold of 3 blocked on one weak word; (6) the image "sexy" class counted at full weight and one image blocked; (7) infinite-scroll rescans (added in the product pass) let long pages accumulate. Fixes: distinct-anchor environment needing a strong anchor, weak-word cap, reweighted terms, path-only hits need corroboration, boilerplate/comment/code text excluded from heading and environment scoring, dwell needs a near-certain image or two flagged images, "sexy" at half weight. Decision logic now lives in `shared/detect.js`.
Not done: a soft "ask, don't block" nudge for the borderline band (needs in-page UI); DOM boilerplate filtering is only checked in a smoke test, not the corpus.
