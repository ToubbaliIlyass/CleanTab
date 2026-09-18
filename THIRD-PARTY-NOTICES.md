# Third-party notices

CleanTab bundles the following third-party code and assets. Everything listed here ships
inside the extension package and runs locally — none of it is fetched at runtime.

## NSFW.js

- **Version:** vendored as `vendor/nsfwjs/nsfwjs.min.js`
- **License:** MIT
- **Copyright:** © Infinite Red, Inc.
- **Source:** https://github.com/infinitered/nsfwjs
- **Use:** image classification for dwell-based detection and the appeal check.

The MobileNetV2-based model weights under `vendor/nsfwjs/model/` are distributed with
NSFW.js under the same MIT license. They are vendored rather than loaded from
CloudFront so the extension makes no network request to classify an image.

## TensorFlow.js

- **License:** Apache License 2.0
- **Copyright:** © Google LLC
- **Source:** https://github.com/tensorflow/tfjs
- **Use:** the inference runtime NSFW.js executes on, inside the offscreen document.

TensorFlow.js is not a separate file in this repository — it is compiled into the
`nsfwjs.min.js` browser bundle listed above. The Apache 2.0 attribution is required all
the same, since the compiled code is redistributed inside the extension package.

## Satoshi

- **License:** ITF Free Font License (Fontshare)
- **Copyright:** © Indian Type Foundry
- **Source:** https://www.fontshare.com/fonts/satoshi
- **Use:** the single typeface across the popup, pause page and onboarding.

Four real weight files (400, 500, 700, 900) are bundled under `Assets/fonts/` rather
than loaded from a font CDN, so no page in the extension makes a request to fetch a
typeface. The ITF Free Font License permits this redistribution. The same typeface is
used on the landing site, so the extension and the site read as one product.

Satoshi ships no 600 or 800 weight. CSS in this repository therefore uses only the four
weights above — asking for an unvendored weight would make the browser synthesise a
fake-bold, which is checked by a test in `tests/static.test.mjs`.

Previously CleanTab bundled Bricolage Grotesque and DM Sans, both under the SIL Open
Font License. Those files were removed when the typeface changed.

---

CleanTab itself is MIT licensed — see [LICENSE](LICENSE).
