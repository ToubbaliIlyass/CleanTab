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
  if (msg.action === "classifyBlob") {
    classify(msg.dataUrl)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  if (msg.action === "nanoAvailability") {
    nanoAvailability()
      .then((state) => sendResponse({ ok: true, state }))
      .catch(() => sendResponse({ ok: true, state: "unavailable" }));
    return true;
  }

  if (msg.action === "nanoAdjudicate") {
    adjudicateWithNano(msg.page)
      .then((verdict) => sendResponse({ ok: true, verdict }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  return false;
});


// ── Gemini Nano session ───────────────────────────────────────────────────────
//
// Hosted here rather than in the service worker because creating a session is
// expensive and MV3 terminates the worker after ~30s idle, which would rebuild it
// constantly. The offscreen document lives as long as it is needed.

let nanoSession = null;
let nanoSessionPromise = null;

async function getNanoSession() {
  if (nanoSession) return nanoSession;
  if (nanoSessionPromise) return nanoSessionPromise;

  const api = nanoApi();
  if (!api) throw new Error("Gemini Nano is not available in this browser");

  nanoSessionPromise = api
    .create({
      initialPrompts: [{ role: "system", content: NANO_SYSTEM_PROMPT }],
      // Deterministic as the API allows: a content filter that changes its mind between
      // identical runs is worse than one that is predictably imperfect.
      temperature: 0,
      topK: 1,
    })
    .then((session) => {
      nanoSession = session;
      nanoSessionPromise = null;
      return session;
    })
    .catch((err) => {
      nanoSessionPromise = null;
      throw err;
    });

  return nanoSessionPromise;
}

async function adjudicateWithNano(page) {
  const session = await getNanoSession();
  const raw = await session.prompt(buildNanoPrompt(page), {
    responseConstraint: NANO_SCHEMA,
  });
  return parseNanoVerdict(raw);
}
