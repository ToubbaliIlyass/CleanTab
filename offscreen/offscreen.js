// NSFW.js classification host.
//
// The model is loaded from the extension bundle, not from the network. nsfwjs.load() with
// no argument resolves to a CloudFront URL — the previous comment here claimed the weights
// were embedded in nsfwjs.min.js, which was wrong. That made every classification silently
// unavailable offline and put a remote request behind a "no external APIs" promise.

const MODEL_URL = chrome.runtime.getURL("vendor/nsfwjs/model/model.json");

let modelPromise = null;

function loadModel() {
  if (!modelPromise) {
    modelPromise = nsfwjs.load(MODEL_URL, { size: 224 }).catch((err) => {
      modelPromise = null; // let the next request retry
      throw err;
    });
  }
  return modelPromise;
}

async function classify(dataUrl) {
  const model = await loadModel();

  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);

  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    const predictions = await model.classify(canvas);

    const result = {};
    predictions.forEach((p) => { result[p.className.toLowerCase()] = p.probability; });
    return result;
  } finally {
    bitmap.close(); // these are large; leaking them on a feed adds up fast
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== "classifyBlob") return false;

  classify(msg.dataUrl)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));

  return true;
});
