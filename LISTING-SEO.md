# Chrome Web Store listing: search-oriented text

> Superseded for 1.0.0 by `store/LISTING.md`, which has the current paste-ready text and the images. The launch reviews and links plan at the end of this file still applies.

Text only. No code or behaviour change. Facts below come from README.md, LANDING.md, the code and the live privacy page (https://cleantab.acture.co/privacy). Limits checked against developer.chrome.com (screenshots 1280x800, max 5; small promo tile 440x280; marquee 1400x560; detailed description has no stated limit; keyword-spam policy applies). Title <=75 and summary <=132 are the limits given for this task.

## Title (store name = manifest `name`) — 66 chars
`CleanTab: NSFW & Porn Blocker, On-Device, With Accountability Lock`

Alternative, shorter and quieter (35): `CleanTab: NSFW Blocker for Chrome`

Not applied to manifest.json (it has uncommitted edits). If you want the store name to match, change only the `name` line. The `description` line is currently "Stay intentional online — CleanTab detects NSFW content and redirects you to focus." It works but does not say "blocker" or "on-device". Proposed replacement (123 chars, valid JSON string):

```json
"description": "Pauses explicit pages and asks what's going on. Detection runs on your device: no account, no server. Free and open source.",
```

## Summary (shown in search results; = manifest `description`) — 123 chars
`Pauses explicit pages and asks what's going on. Detection runs on your device: no account, no server. Free and open source.`

## Category
Pick the closest of the categories shown in the dashboard at submission (the docs page does not list them; check the dropdown). Suggested order: Productivity (or its "Tools" subgroup) first, Lifestyle second. "Accessibility" would be inaccurate. Under Additional fields, review the Mature content toggle: the extension contains no explicit material, so it should be off, but read the question in the dashboard and answer honestly.

## Detailed description (paste as plain text)
```
CleanTab is a free, open-source NSFW blocker for Chrome. When a page looks explicit, it stops the tab and asks one kind question: what is actually going on right now? Hard to remove, kind when it catches you.

WHAT IT DOES
• Checks a built-in list of adult domains.
• Scores the address, title, links and text of pages, matching whole words (so "Essex" does not trigger "sex").
• Checks pictures you linger on for about two seconds, using an NSFW.js model that ships inside the extension. Pictures you scroll past are never looked at, and one picture alone never blocks a page. On by default; you can turn it off.
• Three sensitivity levels: Strict, Balanced (default) and Lenient.
• A pause screen with a short reflection, a breathing exercise and "Let me through once" for false alarms.

PRIVATE BY DESIGN
• Runs on your device. No account, no CleanTab server, no analytics or telemetry.
• The image model is bundled, so detection works offline.
• Settings and counters stay in your browser. Export or erase them any time.
• Open source (MIT): https://github.com/ToubbaliIlyass/CleanTab

HARD TO TURN OFF
• Accountability partner: someone else keeps a passphrase (only a one-way hash is stored, on your device).
• Lock hours: pick the hours when the off switch does not exist.
• Escalating cooldown: one hour, doubling if you disable again within a week, capped at 24 hours.
• For devices you own or administer, with the user's knowledge: Chrome enterprise policy can prevent removal. Guide and config generator: https://cleantab.acture.co/deploy

A RING, NOT A STREAK
Counts how many of the last 14 days were protected. A slip lowers it by one and it recovers. Nothing resets to zero.

HONEST LIMITS
• It will miss some explicit pages and flag some harmless ones. It is a tool, not a guarantee, and not a treatment.
• Keyword detection is English only. The image model is less reliable on swimwear, lingerie and art.
• It protects Chrome only. For full coverage, add DNS filtering and your operating system's parental controls: https://cleantab.acture.co/block-adult-content-in-chrome

WHY IT NEEDS "READ ALL WEBSITES"
A content blocker has to read the pages it judges. The reading happens in your browser; only a score and a verdict are kept. Every permission is explained: https://cleantab.acture.co/privacy

Questions or feedback: toubbaliilyasse@gmail.com
```
(About 2,300 characters. Do not add more keywords; the policy penalises repetition.)

## Five screenshot caption ideas (1280x800 each)
1. "Pause. What's actually going on right now?" (the pause screen with reflection chips)
2. "A ring, not a streak: 12 of the last 14 days protected" (popup, Progress)
3. "Hard to remove: accountability partner and lock hours" (Guard tab)
4. "Runs on your device. No account, no server." (privacy view or Sites tab with export)
5. "Pick your sensitivity: Strict, Balanced, Lenient" (settings, with the image-scanning toggle visible)
Use real UI only, no fabricated numbers presented as user stats; label example data as an example.

## Three promo tile lines (440x280 small tile; reuse for marquee)
1. "Pause before you spiral."
2. "An NSFW blocker that stays on your device."
3. "Hard to remove. Kind when it catches you."

## Support and privacy URLs
- Privacy policy URL: https://cleantab.acture.co/privacy (dedicated page; already states what is stored and that nothing leaves the device except the appeal fetch).
- Homepage URL: https://cleantab.acture.co/
- Support URL: use the GitHub issues page https://github.com/ToubbaliIlyass/CleanTab/issues or the contact email; pick one monitored place.
- Official URL (optional): verify cleantab.acture.co (or its parent domain) in Search Console with the same Google account as the developer account; this ties the listing to the site.
- Note: README.md links `github.com/ilyasstoubbali/CleanTab`, which returns 404 (checked 2026-10-28). The working repo is `ToubbaliIlyass/CleanTab`. Fix the README link before the listing goes live.

## Single purpose statement
"CleanTab blocks web pages the user does not want to see: explicit pages always, and streaming and social-feed sites during focus sessions the user starts or schedules. Blocked pages are replaced with a pause screen."

(Updated for 1.0.0. Both halves are one purpose, a website blocker; say so in these words if the reviewer asks. The manifest now carries the name `CleanTab: NSFW Blocker & Focus Mode` and the summary `Pauses explicit pages and closes streaming and endless feeds while you focus. Runs on your device: no account, no server.`, which supersede the title and summary proposed above.)

## Permission justifications (reuse the privacy page wording)
- Host access (all sites): to read the text and links of the page being judged; reading happens locally and content is never transmitted.
- tabs: to redirect a flagged tab to the pause screen and return after an appeal.
- scripting: to start protecting tabs that were already open on install or update; injects only CleanTab's own scanner.
- storage: settings and counters, local only.
- alarms: roll the day over and end a timed pause.
- idle: do not count minutes while away, and do not count focus time while the screen is locked.
- offscreen: run the image classifier in a hidden document.
Remote code: none (model and libraries are bundled).

## Launch reviews and links plan (legitimate only)
Reviews
- Ask real users, one at a time and never with incentives or gating ("review if you liked it"). Ask people who have used it for two weeks or more: friends and people from the GitHub repo who opened issues.
- Add a quiet, optional "Rate CleanTab" link in the popup only after the listing exists, and only after meaningful use (not on install). That is a product change; do it separately.
- Reply to every review, especially critical ones, with facts. Never post, buy or trade reviews.
Links and mentions
- Keep the GitHub README, repo description and website pointing at the store URL once it exists.
- Genuine posts where you explain the build: a "Show HN"-style post, r/chrome_extensions or self-improvement communities that allow tool posts (read each community's self-promotion rules first), your Instagram and Ko-fi pages. Say you are the author.
- Submit to curated lists of open-source extensions or digital-wellbeing tools by opening a normal pull request or form where the list accepts them.
- Write the "why I built it" story once (the README already has the seed); publish it on your own site only if it adds something not in existing pages.
- No link exchanges, paid links, directories-in-bulk or comment spam.
