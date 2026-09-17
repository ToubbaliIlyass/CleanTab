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

## Bricolage Grotesque

- **License:** SIL Open Font License 1.1
- **Copyright:** © 2022 The Bricolage Project Authors
- **Source:** https://github.com/ateliertriay/bricolage
- **Use:** display typeface in the popup, pause page and onboarding.

## DM Sans

- **License:** SIL Open Font License 1.1
- **Copyright:** © 2014-2023 Colophon Foundry, Jonny Pinhorn, Indian Type Foundry
- **Source:** https://github.com/googlefonts/dm-fonts
- **Use:** body typeface in the popup, pause page and onboarding.

Fonts are bundled under `Assets/fonts/` rather than loaded from Google Fonts, so no page
in the extension makes a request to a font CDN. The OFL permits this redistribution.

---

CleanTab itself is MIT licensed — see [LICENSE](LICENSE).
