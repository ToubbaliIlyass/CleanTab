# What changed (for the website)

Plain-language summary of everything a user can see or that the site should now say.

## The ring is now "protected days"
- **Old:** a daily ring of "clean minutes" with a minutes goal; the popup said "Closed days", "Blocks today"; the pause page said "Your ring is at 65%, 22 minutes to close".
- **New:** the ring and the plant show **N of the last 14 days protected**. A day is **protected** when protection stayed on, you browsed about 10 minutes, and you did not use "Let me through once" or pause protection. Other day types: **passed through**, **paused**, **quiet** (too little browsing; never counts against you).
- A slip lowers the count by one and it recovers as days pass. **Nothing resets to zero.** No streak counter; a personal "longest run" is shown as a record only.
- Popup stats are now **Protected days / Pauses today / Reflections**. "Blocks" is now called **pauses** everywhere.
- The plant grows sprout (0-3), leafy (4-9), bloom (10-14 protected days). The toolbar arc shows the same number out of 14.
- The heatmap is colour-coded by day type (green protected, yellow passed through, pink paused, sand quiet), with text for screen readers and tooltips.
- Milestone stickers at **7, 30 and 100** protected days. Old "closed days" carry over as protected days; no stored data was rewritten.
- A small **"Protected day. Nice work." toast with confetti** appears once on a protected day (no confetti with reduced motion).
- **After a slip**: a calm card, "That happens. You've still protected N of the last 14 days, and tomorrow is a fresh page." No red, no failure counts.
- **Welcome back** card after 14+ days away: "There's nothing to catch up on."
- **This week** recap (protected days, pauses, reflections, most common feeling, time of day) with a **Copy summary** button. Counts only, never sites; nothing is sent anywhere.

## New features
- **Pause for 10 min** (Now tab): 30-second breather first, max 3 a day, logged, and it still respects the lock window, administrator policy and partner passphrase. The full pause (1 h+ cooldown) is unchanged.
- **Block sites yourself**: "Block site" on the current-site card and a "Blocked by you" list in the Sites tab. Subdomains are included, and "This site is fine" cannot override your own block.
- **Faster blocking**: the built-in adult-site list and your blocklist are checked as soon as the page starts, not after it finishes loading.
- **Works in tabs that were already open** when the extension was installed or updated (no reload needed).
- **Practice pause** at the end of onboarding: opens the real pause screen with nothing flagged and nothing saved.

## Pause page
- Prompt is now "What's going on right now? Optional." New feelings: **Just curious**, **Not sure**. New **Close this and move on** button.
- Optional **if-then plan** ("Next time I feel this, I will..."), saved on the device and shown back next time.
- New short, non-shaming lines per feeling. They refer to protected days, never minutes to close or counts of failures.

## Onboarding
- Redesigned as one fixed-size, centred card with the progress bar at the top and buttons pinned at the bottom. Each step fits without page scrolling at 1440x900, 1280x720, 1024x640, 800x600 and phone width (checked); the decorative previews hide on small windows.
- The "how many hours a day" question is gone (it no longer drove anything). Balanced sensitivity is pre-selected. The last step is "You're set" with a summary and the practice pause. Still six steps.

## Look
- Playful theme across popup, onboarding and pause page: Gabarito, Caveat Brush, DM Mono (all bundled), warm brown on cream with coral, butter, sage, sky, peach, blush, lilac; sticker shadows; a plant next to the ring.

## Permissions and privacy
- **New permission: `scripting`** (to inject into already-open tabs). Chrome's install warning does not change because access to all sites was already requested.
- No new network requests, accounts or analytics. Requests still go only to the sites you browse (image fetch when image scanning is on; the page you ask to review).
- Unchanged: no web-accessible resources, no remote code or fonts.

## Behaviour notes
- Sites on the built-in adult list are blocked immediately unless you trusted them, paused protection or used a one-time pass.
- Pages that grow a lot after loading (infinite scroll) are re-checked, up to 5 times per page.
- The image classifier is released after 5 idle minutes to save memory.
- Not done yet (do not advertise): SafeSearch enforcement, remote partner codes, themes.

## Mascot (the cream browser-tab character)
- **Pause page:** the mascot holding the pause sign sits beside "Pause." with a gentle blink and breath. During the breathing exercise a sleepy mascot breathes in time with the orb.
- **Popup:** a small mascot next to the ring and plant: happy on a protected day (it hops during the celebration), sprout on day one, sleepy when protection is off or paused, otherwise keeping watch. The encouraging pose appears in the kind post-slip card; happy or sprout in the weekly recap; the default pose on the locked and partner screens.
- **Onboarding:** wave on the welcome step, then thinking, default, sprout and happy through the steps. It is hidden on small windows so no step needs scrolling (rechecked at 1440x900, 1280x720, 1024x640, 800x600, 420x760).
- **Icons:** the toolbar and store icons (16/32/48/128) are now the mascot. The toolbar icon is the mascot inside the protected-days arc, drawn live.
- All animation is CSS-only and turned off with reduced motion. Everything is bundled; no new permissions or web-accessible resources.

## Fewer false positives
- Detection is stricter about what counts as adult: shopping, health, news, museum, forum, code and game pages that mention words like "nude", "naked", "hardcore", "cam" or "bikini" are no longer blocked. A topic in a page's address alone no longer blocks; the page itself must also look adult.
- Image scanning needs one near-certain image or two flagged images, and counts "sexy"-class results at half weight.
- Unchanged: known adult sites and direct explicit searches still block; "Let me through once", "This site is fine" (trust) and your own blocklist work as before.

## Bigger mascot with a mood
- The popup's Now tab has a hero-sized mascot beside the ring (about 118px) with a one-line caption in its voice. The popup still fits without scrolling.
- Its mood follows real data only: asleep when protection is off, waving hello before any tracked day, calm on a quiet day, happy as protected days build or today is protected, celebrating (bounce, sparkles) at 10+ of 14 protected days or a 7/30/100 milestone, and warm and encouraging after a pass-through or pause. Never sad.
- Changes swap with a small pop; idle motion is off under reduced motion; the mascot has a spoken label like "CleanTab mascot, celebrating". No new poses were drawn; the kit's existing ones are used.

## Toolbar icon
- The Chrome toolbar icon is now the mascot's smooth rounded face (same outline, tab with orange dot and orange shadow as the manifest icon), small. No bar or ring on the icon; progress is in the tooltip ("N of the last 14 days protected").
- Its expression follows the same mood as the popup mascot: asleep (flat closed eyes, little z) when protection is off, wide-eyed hello with no data yet, calm (the plain two-eye icon), happy ^ ^ eyes with an open smile, celebrating (adds a gold sparkle), and warm closed eyes with a blush and soft smile after a pass-through or pause.
- The tooltip now says the mood line and "N of the last 14 days protected". The store and manifest icons are the neutral calm face.

## 1.0.0: focus mode, and the protected-days count made accurate

### Focus mode (new)
- A **Focus** tab in the popup, and a one-tap strip on the Now tab. Start 25, 50 or 90 minutes (or type a number); streaming sites and endless feeds close until the timer ends. Everything else stays open.
- **Streaming:** Netflix, YouTube, Twitch, Prime Video, Disney+, Hulu, Max, Crunchyroll, Apple TV, Peacock, Paramount+, Dailymotion, Kick and a few more. **Doom scrolling:** TikTok, Instagram, Facebook, X, Reddit, Threads, Snapchat, Pinterest, Tumblr, 9GAG, Bluesky, Imgur, the LinkedIn feed and YouTube Shorts. Each group can be switched off, **Keep YouTube open** leaves videos available (Shorts still close), and you can add your own sites.
- **Schedule:** optional days and hours when focus starts by itself.
- A closed site shows the pause page as "Focus." with the time left. **I need this site** opens it for 5 minutes, three times per site per day. When focus ends, the page offers the way back.
- **Ending early** takes a 30-second breather. A session started by mistake can be cancelled outright in its first minute. While focusing you can add to the list but not remove from it.
- The toolbar icon shows the minutes left. The Focus tab shows time focused today and this week.
- Focus is an extra layer on top of protection. Protection stays on for as long as focus is on: starting focus ends any pause, and protection cannot be paused or disabled until focus is over. Focus applies to trusted sites, is not written to the block log, and never changes a day from protected to anything else.
- No new permissions. Music and creator tools (YouTube Music, YouTube Studio, Facebook Business) stay open.

### Protected days: what was wrong, and is fixed
- **Minutes stopped counting two minutes into every page.** A page was only credited while its scan was under two minutes old, and a page is scanned when it loads. An hour on one article counted as two minutes, so many real days stayed "quiet" instead of "protected". A scan now stays valid until the tab goes somewhere else.
- **Reading counted as being away.** No keyboard or mouse for 60 seconds stopped the count. It is now five minutes.
- **Minutes counted while you were in another app.** Chrome has to be the window in front now.
- **The first half hour after midnight was written into yesterday.** The day only rolled over on a 30-minute timer, so a pass-through at 00:10 could spoil the previous day, and the popup could show yesterday's numbers as today's. Every write now rolls the day over first, and so does opening the popup.
- **The lifetime count and milestones ran a day behind.** "Protected days" did not include today even when the ring said today was protected, and the 7/30/100 celebration came on day 8/31/101. Both now include today.
- **A pause taken just before midnight** left the next day looking untouched while protection was still off. The new day is now marked paused as well.
- If the computer's clock moves backwards, the current day is kept instead of being archived and overwritten.

### Smaller fixes
- Restoring a backup (popup or setup page) can no longer switch protection off, end a focus session or reset the daily limits; on a device that is already set up, it can no longer clear a partner passphrase or lock window.
- Partner prompts used the wrong field and never showed the partner's name.
- The practice pause had a stray separator dot after its last button.
- The ring's screen-reader label still described the old "clean share" metric.
- `manifest.json`: version 1.0.0, store name and summary updated to cover focus mode.
- `sh tools/package.sh` builds the store zip (runtime files only, tests must pass first).

### Still decided by you
- Nothing open on the pass-through question: see below.
- The landing site's privacy page and feature copy do not mention focus mode yet.

### "Let me through once" and the protected day
- Using it still marks the day as passed. Then CleanTab checks the page's images on your device (the same check "This site is fine" uses). If at least three images could be read and none was flagged, the pass is taken back and the day stays protected. If anything was flagged, or there was too little to judge, the pass stands.
- Sites on the adult list or your own blocklist are never checked; a pass there always counts.
- Limit to know about: the check reads images only. A page that is explicit in text alone, with clean pictures, would be cleared.

### Popup wording
- "Pause" now means one thing, the pause screen. Switching protection off is called off: "Off for 10 min", badge "Off", "Protection is off". Leaving one site unchecked is "Skip this site". The count of pause screens is "Blocked today", and the lifetime number is "Total protected" so it is not confused with the ring's 14-day number.
- The plant moved from the corner of the ring to a card at the top of Progress that says what stage it is at and what makes it grow.
- An empty ring no longer shows an orange dot.
- Guard: "Image scanning" is now "Extra checks" (it also holds the on-device AI option), and the image toggle no longer says "Off while untuned".

## Friction pass: nothing gets looser on a click

The rule, written down in `shared/friction.js`: every way of getting less protection costs a wait, a phrase, a partner or locked hours. Getting more protection is instant. This replaces the earlier rule that getting past a block should stay one click.

### What was undermining it, and what it is now
| Was | Why it was a hole | Now |
|---|---|---|
| "Let me through once": one click, 10 minutes, any site | Worked on known adult sites too: three uses per site per day, on as many sites as you like | Replaced by **Check this page**. The page's words and pictures are re-read on the device. Clean: it opens, free, day stays protected. Not clean: **Open it anyway** waits 30 s, doubling with each pass-through that day (up to 5 min), counts as a pass, needs the partner's passphrase if there is one, is closed during locked hours, and is capped at three per site per day |
| Adult-list sites could be passed through, trusted or skipped | One click made a known adult site permanently unchecked | The adult list and your own blocklist cannot be passed through, trusted or skipped. The pause page offers no way round them |
| "Off for 10 min" (30 s wait, three a day) | Up to half an hour a day with everything off, for 90 seconds of waiting | Removed. Switching off is the full flow only: passphrase, cooldown, passphrase |
| "Skip this site" (15 min, 1 hour, rest of today): one click | Unchecked browsing on any site | Goes through the gate, "rest of today" is gone, and it marks the day as not protected |
| Trust site (site card, Sites tab, Recently blocked): one click | Permanent, and a blocked site could be trusted straight from the block list | Goes through the gate |
| Unblock a site you blocked: one click | Undid a decision made in advance | Goes through the gate |
| Sensitivity to a looser level, picture checking off, second opinion off | One click to weaken detection | Goes through the gate. Stricter is instant |
| Locked hours: switch off or move them any time outside the window | The lock could be removed just before it mattered | Goes through the gate |
| Run setup again, and the setup page's address | Setup rewrites sensitivity and the lock; the page could be opened directly | Gate first, and the setup page refuses to run unless it was just unlocked from the popup |
| Restore a backup | A file could carry a looser sensitivity, a trust list or an empty blocklist | Goes through the gate |
| "This site is fine" checked pictures only | A site explicit in words with clean pictures could be trusted for good | Uses the whole-page check |

**The gate**, in order: an administrator's policy or your locked hours refuse outright; a partner's passphrase is asked for if one is set; otherwise a 30-second wait.

### Also
- The Now tab shows a row when incognito windows are not covered, with the way to fix it.
- The whole-page check never answers "clean" for a page it could not really read (little text, fewer than three readable pictures, or a failed fetch). Those stay closed and are treated like a flagged page.

### What an extension cannot add friction to
- Removing or disabling CleanTab at `chrome://extensions`, another browser, another profile or guest mode. Only an administrator policy (the /deploy page) and DNS filtering cover these.
- Image scanning is still off by default; that is the biggest remaining gap in detection rather than friction.

## Pictures you linger on, on by default
- Picture checking is now on for new installs (existing installs keep their choice; Lenient still turns it off).
- Only pictures you stop on are looked at: on screen, mostly visible, page still, tab in front, for two seconds. A picture you scroll past is never checked.
- One picture never blocks a page. Evidence adds up per page: a flagged picture is 1 point, a near-certain one 2, and staying on a flagged picture adds 1 for each further 4 seconds (up to +2 if near-certain, +1 otherwise). The page is paused at 3 points.
- So what blocks is: staying about six seconds on a clearly explicit picture; lingering on three flagged pictures; or a clear one plus a borderline one. A single borderline picture can never block, however long it is looked at.
- Points fade after two minutes, the same picture is never counted twice, and small pictures (under 260px, or 180px on image sites) are ignored.

## Days: three things instead of four
- The heatmap and the Now tab show **Protected**, **Slip** and **Not counted**. "Passed through" and "Switched off" were two names for the same thing from the user's side, so both are a slip now, in one colour, with a line under the legend saying what each means.
- A fresh install no longer runs the old migrations over an empty profile (that was silently giving new users pre-1.0 defaults).
