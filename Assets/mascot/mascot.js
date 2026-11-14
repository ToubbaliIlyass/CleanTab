// Mascot loader. The kit's SVGs ship inside the extension (Assets/mascot/) and are
// inlined so CSS can animate their parts (ct-* classes). Decorative only: the SVG is
// hidden from assistive tech. Needs no web-accessible resources: an extension page can
// read its own files.

const mascotCache = {};

async function mountMascot(host, pose) {
  if (!host || host.dataset.pose === pose) return;
  try {
    if (!mascotCache[pose]) {
      const res = await fetch(chrome.runtime.getURL(`Assets/mascot/${pose}.svg`));
      mascotCache[pose] = await res.text();
    }
    host.innerHTML = mascotCache[pose];
    host.dataset.pose = pose;
    const svg = host.querySelector("svg");
    if (svg) {
      svg.setAttribute("aria-hidden", "true");
      svg.removeAttribute("role");
      svg.removeAttribute("aria-label");
    }
  } catch {
    // No mascot is better than a broken page.
  }
}
