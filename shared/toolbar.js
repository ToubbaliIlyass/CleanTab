// The toolbar icon. Per-mood PNGs (16 and 32 px, smooth and anti-aliased) are generated
// from the mascot's own icon artwork by tests/gen-toolbar.mjs and shipped in
// Assets/mascot/toolbar/. Each is the same rounded face, tab and orange shadow as the
// manifest icon with only the expression changed. Nothing is drawn at runtime, so
// updating the icon is one cheap chrome.action.setIcon({ path }) call.
//
// Progress is not drawn on the icon (it hurt the mascot look); it goes in the tooltip.

const TOOLBAR_LEVELS = ["asleep", "hello", "calm", "glad", "celebrate", "warm"];

// mood level -> { level, path: { 16: url, 32: url } }. Unknown levels fall back to calm.
function toolbarSpec(level) {
  const l = TOOLBAR_LEVELS.includes(level) ? level : "calm";
  return {
    level: l,
    path: {
      16: `Assets/mascot/toolbar/${l}-16.png`,
      32: `Assets/mascot/toolbar/${l}-32.png`,
    },
  };
}
