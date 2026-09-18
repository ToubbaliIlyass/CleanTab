# Self-hosted fonts

CleanTab ships its own font files so no page makes a network request at runtime.
Previously `popup.html`, `redirect.html` and `onboarding.html` each loaded
`fonts.googleapis.com`, which pinged Google on every block event and left the
redirect page in fallback fonts when offline.

`fonts.css` is generated, not hand-edited. The typeface is **Satoshi** (Indian Type
Foundry, ITF Free Font License) — the same one the landing site uses.

To regenerate:

1. Fetch the Fontshare CSS:

   ```
   curl -s "https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap" \
     -o /tmp/satoshi.css
   ```

2. For each `@font-face`, download only the `.woff2` (the `.woff` and `.ttf` fallbacks are
   dead weight in a Chrome-only extension) and save it as `satoshi-<weight>.woff2`.

3. Rewrite each `url(...)` to the bare filename — `url(satoshi-700.woff2)`. CSS resolves
   `url()` against the stylesheet's own location, not the page that links it, so a path
   like `../Assets/fonts/x.woff2` resolves to `Assets/Assets/fonts/` and silently fails.

**Satoshi has no 600 or 800 weight.** Use only 400, 500, 700 and 900 in page CSS; any
other value makes the browser synthesise a fake-bold. `tests/static.test.mjs` fails if a
page asks for a weight this directory does not contain.
