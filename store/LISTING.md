# Chrome Web Store listing kit (CleanTab 1.0.0)

Everything to paste into the Developer Dashboard, in the order the dashboard asks for it.
Images are in this folder. This file replaces the text in `LISTING-SEO.md`.

`dist/cleantab-1.0.0.zip` was rebuilt on 2026-11-16 from the working folder and contains the
weekly report, the popup polish, the wider focus-mode detection and the coffee link. If the
code changes again, run `sh tools/package.sh` before uploading.

---

## 1. Store listing tab

### Name (comes from manifest.json, 35 characters)
```
CleanTab: NSFW Blocker & Focus Mode
```

### Summary (comes from manifest.json, 121 of 132 characters)
```
Pauses explicit pages and closes streaming and endless feeds while you focus. Runs on your device: no account, no server.
```

### Description (paste as plain text)
```
CleanTab is a free, open-source NSFW blocker and focus mode for Chrome. When a page looks explicit, it pauses the tab and asks one question: what is going on right now? It is hard to turn off, and kind when it catches you.

Everything runs on your device. There is no account, no CleanTab server and no analytics.

HOW IT BLOCKS
• A built-in list of adult sites, plus your own blocklist.
• The words on the page: the address, title, links and text, matched as whole words, so "Essex" does not trigger anything.
• The pictures you stop on. A picture is checked only after you stay on it for about two seconds, by a model that ships inside the extension. Pictures you scroll past are never looked at, and one picture alone never blocks a page.
• Three sensitivity levels: Strict, Balanced (the default) and Lenient.

A PAUSE, NOT A WALL
• The pause screen asks what you are feeling, then shows the plan you wrote for that feeling.
• A short breathing exercise is one tap away.
• Blocked by mistake? "Check this page" reads the page again, and a clean page opens straight away.
• If the page still reads as explicit you can open it anyway after a wait that doubles each time, up to three times per site per day. That day counts as a slip.
• Sites on the built-in list or on your own blocklist never open this way.

FOCUS MODE
• Start 25, 50 or 90 minutes, or set the hours once and let it start by itself.
• Streaming and doom scrolling close until the timer ends. Everything else stays open.
• It does not rely on a list alone. A site nobody listed still closes when it plays a film, a show or live TV, when you flick through short videos one after another, or when a page of posts keeps loading more as you scroll.
• A normal YouTube video stays open, so tutorials and music keep working. Shorts close. You can close YouTube altogether if you prefer.
• Need a site for work? Open it for five minutes, up to three times a day.

A RING, NOT A STREAK
• The ring counts protected days out of the last 14. A slip lowers it by one, then it recovers. Nothing resets to zero.
• Every week you get one page: your week day by day, how often you walked away, your hardest hour and what you were feeling. It is built on your device and goes nowhere.

HARD TO TURN OFF
• Lock hours: pick the hours when the off switch does not exist.
• Accountability partner: someone else keeps a passphrase. Only a one-way hash is stored, on your device.
• A typed phrase and a cooldown that starts at one hour and doubles on repeat use.
• Making CleanTab stricter is instant. Making it looser always takes a wait, a phrase or another person.
• On devices you own or manage, Chrome's own policy settings can also prevent removal. Guide: https://cleantab.acture.co/deploy

PRIVATE BY DESIGN
• Nothing CleanTab reads leaves your device.
• Your counts, reflections and settings are stored in Chrome on your device. Export or erase them at any time.
• The code is public under the MIT licence: https://github.com/ToubbaliIlyass/CleanTab
• Free, with nothing locked behind payment. After a week the popup may offer a link to buy the maker a coffee. It is optional, and one tap puts it away.

HONEST LIMITS
• It will miss some explicit pages and flag some harmless ones. It is a tool, not a guarantee and not a treatment.
• Word detection is English only. The picture model is less reliable on swimwear, lingerie and art.
• It covers Chrome on a computer. It works in Incognito only if you allow it on the extensions page.
• For fuller coverage, add DNS filtering on your network: https://cleantab.acture.co/block-adult-content-in-chrome

WHY IT ASKS TO READ ALL WEBSITES
A blocker has to read the pages it judges. The reading happens inside your browser. Every permission is explained here: https://cleantab.acture.co/privacy

Questions and bug reports: https://github.com/ToubbaliIlyass/CleanTab/issues
```

### Category
Pick from the dropdown. First choice: the Productivity group ("Workflow & Planning" or "Tools",
whichever is offered). Second choice: Lifestyle ("Well-being").

### Language
English.

### Graphics (all in this folder)
| Field | File | Size |
|---|---|---|
| Store icon | `../Assets/icon128.png` | 128 x 128 |
| Screenshot 1 | `screenshot-1-pause.png` | 1280 x 800 |
| Screenshot 2 | `screenshot-2-ring.png` | 1280 x 800 |
| Screenshot 3 | `screenshot-3-focus.png` | 1280 x 800 |
| Screenshot 4 | `screenshot-4-report.png` | 1280 x 800 |
| Screenshot 5 | `screenshot-5-lock.png` | 1280 x 800 |
| Small promo tile | `promo-small-440x280.png` | 440 x 280 |
| Marquee promo tile (optional) | `promo-marquee-1400x560.png` | 1400 x 560 |

Upload the screenshots in this order. The first one is the image shown in search results.
Every screen in them is the real extension, with example data, and each image says so.

### Additional fields
- Official URL: `cleantab.acture.co` (verify the domain in Search Console with the same Google account first).
- Homepage URL: `https://cleantab.acture.co/`
- Support URL: `https://github.com/ToubbaliIlyass/CleanTab/issues`
- Mature content: No. The extension contains no explicit material.

---

## 2. Privacy tab

### Single purpose
```
CleanTab blocks web pages the user does not want to see: explicit pages always, and streaming and social-feed sites during focus sessions the user starts or schedules. Blocked pages are replaced with a pause screen.
```

### Permission justifications
**tabs**
```
Used to send a flagged tab to the pause screen, to return to the original page after the user asks for a re-check, and to show the current site's status in the popup.
```
**storage**
```
Stores the user's settings, blocklists, daily counters and reflections in chrome.storage on the device. Nothing is synced or sent anywhere.
```
**alarms**
```
Rolls the daily counters over at midnight, ends timed pauses and cooldowns, and starts and ends focus sessions on time.
```
**idle**
```
Stops counting browsing minutes and focus minutes while the user is away or the screen is locked, so the daily record is accurate.
```
**offscreen**
```
Runs the bundled on-device image classifier in a hidden offscreen document, because a service worker cannot run it. No page content leaves the device.
```
**scripting**
```
Injects CleanTab's own content script into tabs that were already open when the extension was installed or updated, so they are protected without a reload. Only files packaged with the extension are injected.
```
**Host permission (`<all_urls>`)**
```
A content blocker has to read the page it judges, and explicit content can appear on any site. The content script reads the address, title, links, text and the images the user stops on, and scores them locally. Only a score and a verdict are kept. Page content is never transmitted.
```

### Remote code
Select **No, I am not using remote code**. The model and all libraries are packaged in the extension.

### Data usage
- Tick **none** of the data-type boxes. CleanTab reads page content and browsing activity on the
  device to do its job, but it does not transmit any of it to the developer or to anyone else.
- Tick all three certifications (no selling data, no unrelated use, no creditworthiness use).
- If the form or a reviewer treats on-device processing as "collection", the two that apply are
  "Web history" and "Website content", both used only for the single purpose and never transmitted.
  Read the wording in the dashboard and answer what it asks.

### Privacy policy URL
```
https://cleantab.acture.co/privacy
```

---

## 3. Distribution tab
- Payments: Free of charge.
- Visibility: Public.
- Regions: All regions.

---

## 4. Test instructions tab (for the reviewer)
```
No account or login is needed. Everything runs locally.

1. Install the extension. A setup page opens; click through it (about one minute).
2. To see the pause screen without visiting explicit content: open the popup, go to the Sites tab, type "example.com" under "Blocked by you" and click Block. Then open https://example.com. The tab is replaced by the pause screen.
3. To see focus mode: open the popup, go to the Focus tab and click "25 min". Then open https://www.reddit.com or https://www.netflix.com. The tab is replaced by the focus screen. Cancel the session from the Focus tab.
4. The popup's Guard tab holds sensitivity and the lock settings. Disabling the extension from inside is slow on purpose (a typed phrase and a cooldown); that is the product's intended behaviour, not a fault.

After a week of use the popup can show one line linking to the developer's Ko-fi page (an optional donation). It is a plain link opened in a new tab; the extension sends nothing to it and nothing is unlocked by donating.

The extension never contacts a server of its own. It makes two kinds of request, both to the site the user is already on: it downloads a picture the user has stopped on so the on-device model can check it, and when the user clicks "Check this page" on the pause screen it fetches that page again to re-read it.
```

---

## 5. Submitting
1. Upload `dist/cleantab-1.0.0.zip` as a new item. It is saved as a draft.
2. Fill in the tabs above and save the draft.
3. Click **Submit for review** and untick **Publish automatically** in the dialog.
4. After approval you have 30 days to press Publish. After that it returns to draft.
5. When it is live, put the store URL in `STORE_URL` in the landing site.
