# Vendor setup

Two pieces, both required, both loaded from the extension bundle. Nothing here is fetched
at runtime — CleanTab makes no network requests of its own.

## `vendor/nsfwjs/nsfwjs.min.js`

The browser bundle. It contains TensorFlow.js but **not** the model weights, despite what
the previous version of this file claimed. `nsfwjs.load()` with no argument falls back to
`https://d1zv2aa70wpiur.cloudfront.net/...`, so the weights have to be vendored separately
and passed explicitly (see `offscreen/offscreen.js`).

```
curl -L https://cdn.jsdelivr.net/npm/nsfwjs/dist/nsfwjs.min.js -o vendor/nsfwjs/nsfwjs.min.js
```

## `vendor/nsfwjs/model/`

MobileNetV2 weights — `model.json` plus one shard, ~2.7 MB.

```
mkdir -p vendor/nsfwjs/model
base=https://raw.githubusercontent.com/infinitered/nsfwjs/master/models/mobilenet_v2
curl -L $base/model.json        -o vendor/nsfwjs/model/model.json
curl -L $base/group1-shard1of1  -o vendor/nsfwjs/model/group1-shard1of1
```

If `model.json` lists more than one shard in its `weightsManifest[].paths`, fetch each one
into the same directory.
