# Vendor setup

## TensorFlow.js

Download `tf.min.js` and place it at `vendor/tfjs/tf.min.js`:

```
curl -L https://cdn.jsdelivr.net/npm/@tensorflow/tfjs/dist/tf.min.js -o vendor/tfjs/tf.min.js
```

## NSFWJS

Download `nsfwjs.min.js` and place it at `vendor/nsfwjs/nsfwjs.min.js`:

```
curl -L https://cdn.jsdelivr.net/npm/nsfwjs/dist/nsfwjs.min.js -o vendor/nsfwjs/nsfwjs.min.js
```

Then download the Inception v3 model files into `vendor/nsfwjs/model/`:

```
npm install nsfwjs
cp -r node_modules/nsfwjs/dist/inception_v3_2/ vendor/nsfwjs/model/
rm -rf node_modules
```

The model directory should contain `model.json` + all `group1-shard*.bin` files (~4 MB total).

## Manifest

`manifest.json` already has `"offscreen"` permission and the `vendor/` files listed
under `web_accessible_resources`. No further changes needed.
