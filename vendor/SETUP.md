# Vendor setup

`vendor/nsfwjs/nsfwjs.min.js` is the only file needed.
It is a self-contained browser bundle that includes TF.js and MobileNetV2 model weights.

To update it:

```
curl -L https://cdn.jsdelivr.net/npm/nsfwjs/dist/nsfwjs.min.js -o vendor/nsfwjs/nsfwjs.min.js
```

No separate TF.js download or model directory required.
