# Self-hosted fonts

CleanTab ships its own font files so no page makes a network request at runtime.
Previously `popup.html`, `redirect.html` and `onboarding.html` each loaded
`fonts.googleapis.com`, which pinged Google on every block event and left the
redirect page in fallback fonts when offline.

`fonts.css` is generated, not hand-edited. To regenerate:

1. Fetch the Google Fonts CSS with a modern browser User-Agent (so you get woff2):

   ```
   curl -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
     (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
     "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=DM+Sans:wght@400;500;600&display=swap" \
     -o fonts-remote.css
   ```

2. Download every `fonts.gstatic.com` URL it references and rewrite each `url(...)` to the
   bare filename — `url(dm-sans-400.woff2)`. CSS resolves `url()` against the stylesheet's
   own location, not the page that links it, so a path like `../Assets/fonts/x.woff2`
   resolves to `Assets/Assets/fonts/` and silently fails. Keep the `unicode-range`
   descriptors as they are.
3. Deduplicate by file hash — Bricolage Grotesque is a variable font, so its 600 /
   700 / 800 faces reference byte-identical files. Deduping takes this directory
   from ~560K to ~192K.
