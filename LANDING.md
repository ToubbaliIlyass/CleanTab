# CleanTab — Landing Page Material

> Source-of-truth for landing-page copy, feature inventory, positioning, and FAQ.
> Lives in the repo so it evolves alongside the product.

---

## Positioning

**One-line pitch**
> Hard to remove. Kind when it catches you.

**Positioning decided 2026-09-17.** Lock strength and voice are independent axes. "Reflect,
don't restrict" is a claim about *tone*, not about being easy to switch off — the earlier
phrasing read as "we don't really block," which was never the intent. The lock is strong
*so that* the voice can be gentle.

**Previous one-liner** (kept for reference, no longer the lead)
> A focus extension that reflects with you, not blocks you out.

**Deeper pitch**
> Most porn blockers treat you like a problem to be locked out. CleanTab treats you like a person trying to do better — with real detection, daily progress, and a one-hour cooldown that gives the impulse time to pass.

**Core narrative**
> Most blockers borrow patterns from gambling apps: streaks, daily quotas, "don't break the chain." They work on a few people and quietly fail the rest, because the moment you slip, the whole structure collapses — and you uninstall.
>
> CleanTab is built on a different premise. The hard part isn't access. The hard part is noticing what's underneath the urge, and giving yourself a second to choose. Everything we built — the dwell-aware detection, the reflection chips, the one-hour cooldown, the ring that resets each day — is shaped by that idea.
>
> No streaks. No shame. No cloud. Just a tool that pauses with you.

---

## Hero copy options

### Option A — Emotional / first-person
### Pause before you spiral.
CleanTab catches the moments your willpower runs thin and asks one question: *what's actually going on right now?* No streaks. No shame. No cloud.

### Option B — Direct / capability-led
### Smarter detection. Softer friction. Zero cloud.
CleanTab uses on-device AI to catch what scrolls past you and gives you a moment to choose. All your data stays on your laptop. Forever.

### Option C — Philosophical
### Reflect, don't restrict.
The browsing intervention built on the idea that lasting change comes from noticing — not punishing.

---

## Tagline candidates

- *Reflect, don't restrict.*
- *Pause before you spiral.*
- *Focus that's local. Forever.*
- *A blocker that thinks like you do.*
- *The browsing intervention that doesn't shame you.*

---

## Three-up feature blocks (use under hero)

### Detection that actually thinks
Word-aware keyword matching, URL parameter intelligence, and on-device image classification that fires only when you *linger* — not every time something scrolls past. Built to catch the moments that matter, ignore the ones that don't.

### A ring, not a streak
Streaks turn focus into a debt you can't pay back. CleanTab tracks clean browsing minutes against a daily ring that resets every morning. Closed yesterday and not today? You haven't lost anything.

### Local. Forever.
No accounts. No syncing. No telemetry. Your data is stored in your browser, exported as JSON if you want a backup, and never leaves your laptop. Period.

---

## How it works

1. **You install. We ask one question.** How many hours a day are you on your laptop? That sets your daily ring goal. You can change it later.
2. **You browse. We watch quietly.** Word-boundary keyword scoring + URL analysis on every page. Image classification on visual platforms when you pause on something.
3. **If something fires, you pause.** A simple page asks: *what's actually going on?* Bored? Stressed? Tired? Lonely? Pick one — or don't.
4. **A tiny reminder.** Tied to the chip you picked, pulled from your own data: "Your ring is at 65% — 22 minutes to close today." One thing. Not a lecture.
5. **You decide what's next.** Take a beat. Appeal if it was wrongly flagged. Or close the tab and go do something else.

---

## Full feature inventory

### Detection
- **Word-boundary keyword scoring** — eliminates substring false positives ("sex" no longer matches "Essex", "cam" no longer matches "camera").
- **URL parameter awareness** — passthrough params like `continue=`, `redirect_uri=`, `next=` are skipped, so Google logins don't get caught by their own redirect chain.
- **Known-domain hard block** — a curated list of adult-site domains is denied without further analysis.
- **Image classification via NSFW.js** — TensorFlow.js + MobileNetV2 running locally in an offscreen document. No network call for inference.
- **Dwell-based image detection** — on *any* site, the extension watches for images you *linger on* — not every image that scrolls by. If you pause on something for 2 seconds, that image gets classified. Image-first platforms (Pinterest, Reddit, X, Instagram, Tumblr, imgur…) use a 180px size floor; everywhere else it is 260px, since images that small are usually chrome and avatars.
- **Page-shape awareness** — text and title scoring run on every page shape *except* an aggregated home feed (`reddit.com/`, `r/popular`, `r/all`, `x.com/home`, `instagram.com/`), where the content was chosen by a recommender rather than by the user. A specific subreddit, a category page or a tag archive is a chosen destination and is scored in full.
- **Per-tab rate limiting** — max one in-flight classification, 3-second minimum gap, prevents battery drain in heavy feeds.
- **Cleared-image cache** — once an image is judged safe, it's never re-classified during that page lifetime.

### Reflection
- **6-chip reflection prompt** on every redirect: Bored / Stressed / Habit / Avoiding / Lonely / Tired. One tap, no typing.
- **Contextual nudge** appears after the chip is tapped — one data-grounded line tied to what you just admitted to feeling:
  - Bored → "Your ring is at 65% — 22 min to close today."
  - Stressed → "Take a moment to breathe" + promoted breathing button
  - Habit → "This is your 3rd pause today."
  - Avoiding → "You've closed your ring on 12 days. Today's still open."
  - Lonely → "Loneliness often fuels the scroll. A quick message to someone real lands deeper."
  - Tired → time-of-day branch ("It's getting late" after 9 pm; otherwise "Your body's giving a signal")
- **Built-in breathing exercise** — 3 cycles of 4-second inhale / hold / exhale, full-screen overlay.
- **Appeal flow** — if you believe a page was wrongly flagged, CleanTab fetches the page and up to 8 of its own images (credentials omitted) and classifies them locally. **No screenshot is ever taken** — `captureVisibleTab` appears nowhere in the codebase. Fewer than 3 classifiable images returns *inconclusive* and holds the block, rather than handing out a permanent bypass by accident.

### Anti-streak gamification (ring model)
- **Daily ring goal** — closes when you accumulate enough clean browsing minutes today. Based on the Zeigarnik effect (the brain hates unfinished circles) and Apple Watch's motivational pattern.
- **Adaptive goal** — calibrated from a single onboarding question (how many hours/day on your laptop) and recalibrated over time.
- **No streaks** — the ring resets fresh every day. Missing a day costs nothing.
- **Cumulative-only metrics** — total closed days, total reflections logged. Numbers only ever go up, removing the "I broke my streak so why bother" failure mode.
- **16-week heatmap** — visualizes when your rings closed, like GitHub contributions.
- **Pattern insights** — after 10 reflections, the popup surfaces which triggers (Bored, Tired, etc.) come up most often.

### Disable friction — "lock strength"
- **Randomized passphrase** — pool of 8 reflective phrases. A different one is picked each time you try to disable.
- **Escalating cooldown** — 1 hour the first time, doubling on each disable within a 7-day window (2h, 4h, 8h…) capped at 24h. Decays after a week, so one bad week doesn't punish you indefinitely. A flat wait treated the first slip and the fifth identically.
- **Two-stage confirmation** — type the passphrase, wait the cooldown, type it again to actually disable.
- **Accountability partner** — a second person sets a passphrase and keeps it; only a one-way SHA-256 hash is stored, locally. No account, no server, no stored contact details. The partner gate runs *before* the cooldown, so the wait isn't spent by someone who was never getting through.
- **Lock window** — nominate hours (default 10pm–6am) when the off switch does not exist. Cannot be edited or switched off from inside the window itself.
- **Managed policy** — an administrator can force-install via `ExtensionInstallForcelist` and pin settings through `chrome.storage.managed` (`allowDisable`, `allowAppeals`, `allowTrustSites`, `sensitivity`, `lockedTrustedSites`). The only layer that is genuinely unremovable. See `/deploy`.
- **Time-bounded pause** — disable for 5 / 15 / 30 minutes; auto re-enables on an alarm even if the popup is never reopened.
- **No paste, no autocomplete** — both the reflective passphrase and the partner passphrase block pasting and drag-drop.

> **The rule that governs this whole section:** friction on *turning CleanTab off* is as high as possible; friction on *getting past one false positive* stays near zero. "Let me through once" is never gated — not by a partner lock, not by a lock window, not by policy. A misfire that becomes unreachable content is what makes people distrust the tool and remove it wholesale.

### Privacy
- **100% local** — all data lives in `chrome.storage.local`. Nothing is ever transmitted.
- **No telemetry, no analytics, no third-party scripts** — the extension makes zero network requests after install.
- **Export / import** — full data backup as a JSON file. Restore on a new device by import.
- **On-device AI** — NSFW.js model weights are bundled with the extension; no API calls, no cloud inference.
- **Open code** — the entire detection logic, scoring, and passphrase pool is visible in the source.

### UX surfaces
- **Popup** — three tabs (Today, Progress, Guard) within a 380×560 frame, no scrolling.
- **Onboarding** — one-question calibration on install, with live goal preview.
- **Redirect page** — pause headline, reflection chips, contextual nudge, breathing button, appeal option.
- **Toolbar badge** — small arc shows today's ring progress at a glance via OffscreenCanvas.

### Technical
- Manifest V3 (service worker + offscreen document)
- No build step. Vanilla JS, plain CSS.
- ~5MB total install size including NSFW.js model weights.

---

## FAQ

**Where does my data go?**
Nowhere. Everything is in `chrome.storage.local` on your machine. Export anytime as a JSON file.

**Do you send images to a cloud API?**
No. NSFW.js runs entirely in your browser using bundled MobileNetV2 weights. There is no inference server.

**Does it work in incognito?**
Only if you explicitly enable the extension for incognito mode in `chrome://extensions`. We don't ask for that by default.

**Can I disable it?**
Yes — but it takes a one-hour cooldown and a randomized passphrase, twice. By design. The friction is the feature.

**What happens if I uninstall?**
All data is wiped (it lived in browser storage). Export first if you want to keep your stats.

**Can I see exactly what's flagged and why?**
Yes. The redirect page tells you what triggered it. Source code is open.

**Does it work on YouTube / Twitter / Reddit?**
On YouTube it ignores normal videos (only flags adult-keyword pages). On Twitter, Pinterest, Reddit, Instagram, and Tumblr, dwell-based image detection is active.

**Why no streaks?**
Streaks turn intrinsic motivation ("I want to focus") into extrinsic ("I have to protect my number"). The moment you slip, the structure collapses and most people uninstall. The ring is designed to be forgiving of bad days without losing the long-term picture.

**What if I want sync across devices?**
Not built. Use export/import to manually move your data. If user demand is high enough, sync could be added later — but it would always be optional, and the local-first storage stays the default.

---

## Voice & tone

### Strong nouns and verbs to lean on
*reflect, notice, pause, choose, close (the ring), local, fresh, soft, intentional, on-device, considered*

### Phrases that fit the brand
*"a moment to choose", "one thing, not a lecture", "the friction is the feature", "noticing, not punishing"*

### Phrases / framings to avoid
- *"Beat your addiction"* → moralizing
- *"Take back control"* → tropey
- *"AI-powered"* as a feature → AI is the *means*, reflection is the value
- *"Don't break the streak"* → directly opposed to the product's premise
- *"Dirty habit", "weak moment", "willpower"* → shame language

---

## Visual / design notes (if building the landing page)

- **Palette**: keep the extension's exact palette so the landing → install hand-off feels continuous.
  - `--bg: #FFFFFF`
  - `--paper: #F8F6F2`
  - `--border: #E4E0D8`
  - `--text: #1C1915`
  - `--text-soft: #78736C`
  - `--accent: #FF6B35`
- **Fonts**: `Bricolage Grotesque` for headlines (700–800 weight), `DM Sans` for body (400–600 weight). Same as the extension.
- **Imagery**: avoid stock photos of people looking dramatically at laptops. Use the actual product UI (popup, ring, redirect page) as the primary visual.
- **Motion**: ring closing animation works well as a hero animation. Subtle, intentional.

---

## Suggested page structure

1. **Hero** — headline + 1-line subhead + install CTA + screenshot of the popup
2. **Three-up features** (detection / ring / local)
3. **How it works** — 5-step illustration
4. **The philosophy section** — long-form narrative on *why* we built it differently
5. **Trust block** — privacy guarantees, no telemetry, open data
6. **FAQ**
7. **Install CTA** (footer)

---

## What we're deliberately not claiming

These are technically true but worth being explicit about so the copy doesn't oversell:

- We do **not** claim 100% detection. False negatives happen. (The visual-platform allowlist is gone as of 2026-09-17 — image scanning runs everywhere — but the classifier is still general-purpose and biased on swimwear, lingerie and fine art.)
- We do **not** claim to be tamper-proof *unless* force-installed by admin policy, and Google's own documentation calls even that best-effort. Without policy: the passphrase pool is in the source, and developer tools defeat any client-side blocker. The friction is for the version of you that's *not* determined.
- We **do** now claim strong lock-out: escalating cooldown, lock window, partner-held passphrase, managed policy. See `/deploy`.
- We are **one layer of three**. DNS filtering and OS controls cover what an extension cannot. Say this before a user discovers it.
- We do **not** claim therapeutic outcomes. CleanTab is a tool, not a treatment. If compulsive behavior is interfering with your life, talk to someone qualified.

Being honest about these makes the rest of the copy land harder.
