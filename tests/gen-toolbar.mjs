// Generates the toolbar icons: Assets/mascot/toolbar/<mood>-<16|32>.png and the contact
// sheet docs/toolbar-moods.png. Run after changing a face:  node tests/gen-toolbar.mjs
//
// Every mood is the kit's icon-small mascot (the smooth rounded face, tab with orange dot,
// orange offset shadow) with only the face changed. Art is rendered large and halved
// step by step so the 16 and 32 px versions are smoothly anti-aliased, not pixel art.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pw = process.env.PLAYWRIGHT_PATH || "/Users/ilyasstoubbaliilyass/Documents/Work/DariScript-Web/node_modules/playwright";
const exe = process.env.CHROME_PATH ||
  "/Users/ilyasstoubbaliilyass/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const { chromium } = createRequire(import.meta.url)(pw);

const base = fs.readFileSync(path.join(ROOT, "Assets/mascot/icon-small.svg"), "utf8");
// Everything up to the face features: shadow, tab, body outline. Eyes and cheeks follow.
const cut = base.indexOf('<ellipse cx="42" cy="72"');
const head = base.slice(0, cut);
const INK = "#2B1B12";
const stroke = (w) => `fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const dots = `<ellipse cx="42" cy="72" rx="9" ry="12" fill="${INK}"/><ellipse cx="86" cy="72" rx="9" ry="12" fill="${INK}"/><circle cx="39" cy="67" r="3.2" fill="#fff"/><circle cx="83" cy="67" r="3.2" fill="#fff"/>`;
const cheeks = (rx = 8, ry = 5) => `<ellipse cx="26" cy="94" rx="${rx}" ry="${ry}" fill="#F2B8C6"/><ellipse cx="102" cy="94" rx="${rx}" ry="${ry}" fill="#F2B8C6"/>`;
const arcsUp = `<path d="M30 76Q42 58 54 76" ${stroke(7)}/><path d="M74 76Q86 58 98 76" ${stroke(7)}/>`;
const arcsDown = `<path d="M30 66Q42 80 54 66" ${stroke(7)}/><path d="M74 66Q86 80 98 66" ${stroke(7)}/>`;
const openMouth = `<path d="M52 90Q64 112 76 90Z" fill="${INK}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`;
const sparkle = `<path d="M108 6Q110 16 120 18Q110 20 108 30Q106 20 96 18Q106 16 108 6Z" fill="#F6C45E" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`;
const zzz = `<path d="M88 6H108L88 26H108" ${stroke(6)}/>`;

const FACES = {
  calm: dots + cheeks(),
  hello: `<ellipse cx="42" cy="72" rx="10.5" ry="14" fill="${INK}"/><ellipse cx="86" cy="72" rx="10.5" ry="14" fill="${INK}"/><circle cx="38.5" cy="66" r="3.8" fill="#fff"/><circle cx="82.5" cy="66" r="3.8" fill="#fff"/>` + cheeks() +
    `<ellipse cx="64" cy="98" rx="5" ry="6" fill="#F07A3C" stroke="${INK}" stroke-width="3.5"/>`,
  glad: arcsUp + cheeks(9, 5.5) + openMouth,
  celebrate: arcsUp + cheeks(10, 6) + openMouth + sparkle,
  warm: arcsDown + cheeks(10, 6) + `<path d="M54 94Q64 102 74 94" ${stroke(5)}/>`,
  asleep: `<path d="M30 74H54" ${stroke(7)}/><path d="M74 74H98" ${stroke(7)}/>` + cheeks() + `<path d="M56 96Q64 100 72 96" ${stroke(4.5)}/>` + zzz,
};

const svgFor = (level) => head + FACES[level] + "</g></svg>";
const levels = Object.keys(FACES);

const b = await chromium.launch({ executablePath: exe });
const pg = await b.newPage({ viewport: { width: 1000, height: 640 } });
await pg.setContent("<body style='margin:0;background:#fff'></body>");

const out = await pg.evaluate(async ({ levels, svgs }) => {
  const load = (svg) => new Promise((res, rej) => {
    const img = new Image(); img.onload = () => res(img); img.onerror = rej;
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
  // Render at 512, then halve repeatedly: each step is an exact 2:1 box filter.
  const down = (src, size) => {
    let cur = src;
    while (cur.width > size) {
      const c = document.createElement("canvas"); c.width = c.height = cur.width / 2;
      const x = c.getContext("2d"); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
      x.drawImage(cur, 0, 0, c.width, c.height); cur = c;
    }
    return cur;
  };
  const res = {};
  window.__icons = {};
  for (const l of levels) {
    const img = await load(svgs[l]);
    const big = document.createElement("canvas"); big.width = big.height = 512;
    big.getContext("2d").drawImage(img, 0, 0, 512, 512);
    window.__icons[l] = { 16: down(big, 16), 32: down(big, 32), 64: down(big, 64) };
    res[l] = { 16: window.__icons[l][16].toDataURL(), 32: window.__icons[l][32].toDataURL() };
  }
  return res;
}, { levels, svgs: Object.fromEntries(levels.map((l) => [l, svgFor(l)])) });

const dir = path.join(ROOT, "Assets/mascot/toolbar");
fs.mkdirSync(dir, { recursive: true });
for (const l of levels) for (const s of [16, 32]) {
  fs.writeFileSync(path.join(dir, `${l}-${s}.png`), Buffer.from(out[l][s].split(",")[1], "base64"));
}

// Contact sheet: reference kit icons, then every mood at true size (light and dark
// toolbar), 2x and 4x enlarged.
const ref = (n) => "data:image/png;base64," + fs.readFileSync(path.join(ROOT, `Assets/icon${n}.png`)).toString("base64");
await pg.evaluate(async ({ levels, r16, r32 }) => {
  document.body.innerHTML = "<canvas id=c width=1000 height=640></canvas>";
  const c = document.getElementById("c").getContext("2d");
  c.fillStyle = "#fff"; c.fillRect(0, 0, 1000, 640);
  const li = (u) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; });
  const i16 = await li(r16), i32 = await li(r32);
  c.font = "13px sans-serif"; c.fillStyle = "#000";
  const cols = ["reference", ...levels];
  cols.forEach((name, k) => {
    const x = 20 + k * 138;
    c.fillText(name, x, 18);
    const a16 = name === "reference" ? i16 : window.__icons[name][16];
    const a32 = name === "reference" ? i32 : window.__icons[name][32];
    c.imageSmoothingEnabled = true;
    c.drawImage(a32, x, 30, 128, 128);                    // 32px at 4x
    c.drawImage(a16, x, 170, 64, 64);                     // 16px at 4x
    c.drawImage(a32, x + 70, 170, 64, 64);                // 32px at 2x
    for (const [bg, ox] of [["#f1f3f4", 0], ["#35363a", 66]]) {
      c.fillStyle = bg; c.fillRect(x + ox, 250, 62, 40); c.fillRect(x + ox, 300, 62, 56);
      c.drawImage(a16, x + ox + 23, 262);                 // TRUE 16px
      c.drawImage(a32, x + ox + 15, 308, 32, 32);         // TRUE 32px
    }
    c.fillStyle = "#000";
  });
}, { levels, r16: ref(16), r32: ref(32) });
await pg.locator("#c").screenshot({ path: path.join(ROOT, "docs", "toolbar-moods.png") });
await b.close();
console.log("wrote", levels.length * 2, "icons and docs/toolbar-moods.png");
