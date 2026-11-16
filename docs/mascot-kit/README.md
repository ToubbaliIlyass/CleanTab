# CleanTab mascot kit

Cream browser-tab character, hand-drawn wobbly ink outline, orange offset shadow. All SVGs are transparent, hand-built paths (not a traced raster), and share one body so poses swap cleanly.

## Files
- `reference.png`: the original art.
- `svg/`: `default` (holds PAUSE sign), `happy`, `sleepy`, `encourage`, `thinking`, `wave`, `sprout`, `coffee`, `peek`, `icon`, `icon-small`.
- `png/`: main poses at 1x (400px wide) and `@2x` (800px); `icon-16/32/48/128.png` (16 and 32 use `icon-small`); `apple-icon-180.png` (solid #FBE3C4 background).
- `contact-sheet.png`: everything on one page.
- `Mascot.tsx`: React component, no deps: `<Mascot pose="happy" size={200} />`.
- `tools/gen.mjs` regenerates the SVGs and `Mascot.tsx` (`node tools/gen.mjs`); `tools/render.mjs` regenerates the PNGs (needs `sharp`).

Full poses share viewBox `6 66 388 388` (square, same scale, so swapping poses does not jump). `peek` is `10 104 376 268`; icons are `0 0 128 128`.

## Which pose where
| Place | Pose |
|---|---|
| Landing hero | `default` (pause sign is the product idea) |
| Pause page / interstitial | `default`, or `sleepy` for a calm breathing moment |
| Popup header | `icon` (or `default` at ~96px) |
| Loading | `thinking` (blink, see below) |
| Empty states | `sleepy` ("nothing here, enjoy the quiet"), `sprout` for "fresh start" |
| Celebration (streak, goal met) | `happy` |
| Post-slip (relapse, not shaming) | `encourage` (closed smiling eyes, heart, small wave) |
| Onboarding steps | 1 `wave`, 2 `thinking`, 3 `default`, 4 `sprout`, done `happy` |
| Coffee / donation | `coffee` |
| 404 | `thinking` or `peek` ("couldn't find that tab") |
| Corners / footers / section edges | `peek` (put it on an edge; the bottom is cut flat, hands overlap the edge) |
| Favicon / extension icon | `icon` (48+), `icon-small` (16/32), `apple-icon-180.png` |

## Palette tokens
```
--ct-cream:  #FFF8EC   body fill
--ct-orange: #F07A3C   shadow, feet, tab dot, sign
--ct-ink:    #2B1B12   outlines (stroke 3.4 in full poses, 5 to 7 in icons)
--ct-pink:   #F2B8C6   cheeks
--ct-nose:   #F2825A
--ct-gold:   #F6C45E   sign ring
--ct-green:  #7DAF63   sprout leaves
```

## Using it
Vanilla JS / extension: inline the file text (fetch + `innerHTML`, or a build-time import) so CSS can reach the groups, or use `<img src="svg/default.svg">` when you do not need animation. Manifest icons: use the PNGs.

React: `import { Mascot } from './Mascot'`. The component uses `dangerouslySetInnerHTML` on the `<svg>` with static, generated markup. Pass `title=""` for decorative use. Parts carry `ct-*` classes (not ids) so several instances do not clash.

In the standalone SVGs the stable ids (and matching `ct-` classes) are: `#mascot #shadow #feet #foot-left #foot-right #tab #body #brows #eyes #eye-left #eye-right #cheeks #nose #mouth #arm-left #arm-right #pause-sign #sparkles`, plus pose extras `#jump #zzz #thought #steam #wave-lines #prop`. If you inline the same SVG twice on a page, target by class (ids would repeat).

## Animation tips
Make every animated group `transform-box: fill-box; transform-origin: center;` (set origin per part below).
```css
.ct-mascot { transform-box: fill-box; transform-origin: 50% 100%; animation: ct-breathe 4s ease-in-out infinite; }
@keyframes ct-breathe { 50% { transform: scaleY(1.025) scaleX(.99); } }

.ct-eyes { transform-origin: 50% 50%; animation: ct-blink 5s infinite; }
@keyframes ct-blink { 0%,94%,100% { transform: scaleY(1); } 97% { transform: scaleY(.08); } }

.ct-jump, .ct-mascot.bounce { animation: ct-bounce .9s ease-in-out infinite; }   /* happy: .ct-jump already offsets -14px */
@keyframes ct-bounce { 50% { transform: translateY(-10px); } }
.ct-shadow { transform-origin: 50% 50%; animation: ct-shad .9s ease-in-out infinite; }
@keyframes ct-shad { 50% { transform: scaleX(.85); opacity: .1; } }

.ct-arm-right { transform-origin: 85% 90%; animation: ct-wave 1.4s ease-in-out infinite; }  /* wave pose */
@keyframes ct-wave { 50% { transform: rotate(-14deg); } }

.ct-pause-sign { transform-origin: 90% 100%; animation: ct-sway 3s ease-in-out infinite; }
@keyframes ct-sway { 50% { transform: rotate(-3deg); } }

.ct-zzz path { animation: ct-float 3s ease-in-out infinite; } /* translateY(-6px) + opacity */
.ct-feet { transform-origin: 50% 0; }                         /* tiny squash on land */
```
Respect reduced motion: wrap in `@media (prefers-reduced-motion: no-preference)`. Keep motion slow and soft to match the calm tone.

## Notes
- Strokes: 3.4 (body/arms), 2.6 to 3 (face details); icons use heavier strokes so they survive 16px. Do not scale full poses below ~64px; use `icon-small` instead.
- The kit is deterministic: edit shapes or seeds in `tools/gen.mjs`, rerun, regenerate PNGs.
