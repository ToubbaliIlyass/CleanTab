let model = null;

async function loadModel() {
  if (model) return model;
  const modelUrl = chrome.runtime.getURL("vendor/nsfwjs/model/model.json");
  model = await nsfwjs.load(modelUrl, { type: "graph" });
  return model;
}

async function classify(dataUrl) {
  const m = await loadModel();

  // Decode the dataURL into an ImageBitmap, then draw onto a canvas
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);

  const predictions = await m.classify(canvas);

  // Map to { porn, hentai, sexy, drawing, neutral } with probabilities 0–1
  const result = {};
  predictions.forEach((p) => {
    result[p.className.toLowerCase()] = p.probability;
  });

  return result;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== "classifyScreenshot") return false;

  classify(msg.dataUrl)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));

  return true; // async
});
