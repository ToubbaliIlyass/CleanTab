// Structural checks on the shipped extension. These are cheap and catch the class of
// mistake that unit tests never see: a file that doesn't exist, a global declared twice
// in one script bundle, a remote request sneaking back into a "runs offline" product.

import fs from "node:fs";
import path from "node:path";
import { ROOT, makeTester, eq, ok, notOk } from "./harness.mjs";

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

// Every script bundle, in the order the browser evaluates it.
const BUNDLES = {
  "service worker": [
    "shared/dates.js", "shared/domains.js", "shared/thresholds.js", "shared/keywords.js",
    "shared/scoring.js", "shared/pageshape.js", "shared/review.js", "shared/schema.js",
    "shared/lock.js",
    "shared/migrations/v0_to_v1.js", "shared/migrations/v1_to_v2.js",
    "shared/storage.js", "background.js",
  ],
  "content script": ["shared/domains.js", "shared/keywords.js", "shared/thresholds.js",
                     "shared/scoring.js", "shared/pageshape.js", "content.js"],
  "popup": [
    "shared/dates.js", "shared/domains.js", "shared/thresholds.js", "shared/schema.js",
    "shared/lock.js",
    "shared/migrations/v0_to_v1.js", "shared/migrations/v1_to_v2.js",
    "shared/storage.js", "popup/popup.js",
  ],
  "redirect": [
    "shared/dates.js", "shared/domains.js", "shared/thresholds.js", "shared/schema.js",
    "shared/migrations/v0_to_v1.js", "shared/migrations/v1_to_v2.js",
    "shared/storage.js", "redirect/redirect.js",
  ],
  "onboarding": [
    "shared/dates.js", "shared/domains.js", "shared/thresholds.js", "shared/schema.js",
    "shared/migrations/v0_to_v1.js", "shared/migrations/v1_to_v2.js",
    "shared/storage.js", "onboarding/onboarding.js",
  ],
};

const declPattern = /^(?:const|let|function)\s+([A-Za-z_$][\w$]*)/gm;

function declarationsIn(file) {
  return [...read(file).matchAll(declPattern)].map((m) => m[1]);
}

export default async function () {
  const t = makeTester("static / structural");
  const manifest = JSON.parse(read("manifest.json"));

  // ── Manifest ───────────────────────────────────────────────────────────────
  t("manifest is v3", () => eq(manifest.manifest_version, 3));
  t("declares a version", () => ok(manifest.version));

  t("every manifest-referenced file exists", () => {
    const refs = [
      manifest.background.service_worker,
      manifest.action.default_popup,
      manifest.action.default_icon,
      ...Object.values(manifest.icons),
      ...manifest.content_scripts.flatMap((cs) => cs.js),
      ...manifest.web_accessible_resources.flatMap((w) => w.resources),
    ];
    eq(refs.filter((r) => !exists(r)), []);
  });

  // Permissions are the first thing a Web Store reviewer reads, and an unused one on an
  // <all_urls> extension is free suspicion.
  t("declares no unused permissions", () => {
    const allCode = BUNDLES["service worker"].concat(BUNDLES.popup, BUNDLES.redirect,
      BUNDLES.onboarding, ["offscreen/offscreen.js", "content.js"])
      .map(read).join("\n");
    const unused = manifest.permissions.filter((p) => !allCode.includes(`chrome.${p}`));
    // `storage` shows up as chrome.storage, `tabs` as chrome.tabs, etc.
    eq(unused, []);
  });

  t("managed schema is declared and exists", () => {
    ok(manifest.storage?.managed_schema, "manifest must declare storage.managed_schema");
    ok(exists(manifest.storage.managed_schema), "the schema file must exist");
    const schema = JSON.parse(read(manifest.storage.managed_schema));
    eq(schema.type, "object");
    // Every manageable key the code merges must be declarable by an administrator,
    // otherwise a policy silently does nothing.
    const declared = Object.keys(schema.properties || {});
    const codeKeys = [...read("shared/lock.js")
      .matchAll(/^\s{2}"([a-zA-Z]+)",$/gm)].map((m) => m[1]);
    eq(codeKeys.filter((k) => !declared.includes(k)), []);
  });

  t("content script load order puts shared modules first", () => {
    const js = manifest.content_scripts[0].js;
    eq(js[js.length - 1], "content.js");
    ok(js.slice(0, -1).every((f) => f.startsWith("shared/")));
  });

  // ── No redeclarations within a bundle ──────────────────────────────────────
  // These share one global scope. A duplicate `const` throws on load and takes the whole
  // bundle with it — this is how the three copies of the keyword list would have failed.
  for (const [name, files] of Object.entries(BUNDLES)) {
    t(`${name}: no duplicate top-level declarations`, () => {
      const seen = new Map();
      const dupes = [];
      for (const f of files) {
        for (const d of declarationsIn(f)) {
          if (seen.has(d)) dupes.push(`${d} (${seen.get(d)} + ${f})`);
          else seen.set(d, f);
        }
      }
      eq(dupes, []);
    });
  }

  // ── No dangling globals ────────────────────────────────────────────────────
  const SHARED_FILES = [
    "shared/dates.js", "shared/domains.js", "shared/thresholds.js", "shared/keywords.js",
    "shared/scoring.js", "shared/pageshape.js", "shared/review.js", "shared/schema.js",
    "shared/lock.js",
    "shared/migrations/v0_to_v1.js", "shared/migrations/v1_to_v2.js", "shared/storage.js",
  ];
  const ALL_SHARED = new Set(SHARED_FILES.flatMap(declarationsIn));

  for (const [name, files] of Object.entries(BUNDLES)) {
    t(`${name}: uses nothing it doesn't load`, () => {
      const loaded = new Set(files.slice(0, -1).flatMap(declarationsIn));
      const src = read(files[files.length - 1]);
      const used = [...ALL_SHARED].filter((g) => new RegExp(`\\b${g}\\b`).test(src));
      eq(used.filter((g) => !loaded.has(g)), []);
    });
  }

  // ── Privacy: the product claims to make no network requests ────────────────
  t("no remote resources in any HTML page", () => {
    const pages = ["popup/popup.html", "redirect/redirect.html",
                   "onboarding/onboarding.html", "offscreen/offscreen.html"];
    const bad = [];
    for (const p of pages) {
      for (const m of read(p).matchAll(/(?:src|href)=["'](https?:\/\/[^"']+)["']/g)) {
        bad.push(`${p} → ${m[1]}`);
      }
    }
    eq(bad, []);
  });

  t("no remote resources in any CSS", () => {
    const bad = [];
    for (const p of ["popup/popup.css", "redirect/redirect.css",
                     "onboarding/onboarding.css", "Assets/fonts/fonts.css"]) {
      for (const m of read(p).matchAll(/url\(["']?(https?:\/\/[^)"']+)/g)) bad.push(`${p} → ${m[1]}`);
      for (const m of read(p).matchAll(/@import\s+url\(["']?(https?:\/\/[^)"']+)/g)) bad.push(`${p} → ${m[1]}`);
    }
    eq(bad, []);
  });

  // This is the one that caught a Google favicon service being added to the popup right
  // after every other remote request was removed.
  t("no code fetches a remote URL", () => {
    const files = ["background.js", "content.js", "popup/popup.js",
                   "redirect/redirect.js", "onboarding/onboarding.js", "offscreen/offscreen.js"];
    const bad = [];
    for (const f of files) {
      read(f).split("\n").forEach((line, i) => {
        if (line.trim().startsWith("//")) return;
        // A literal https:// URL assigned to src/href or passed to fetch().
        if (/(?:\.src\s*=|fetch\(|\.href\s*=)[^;]*["']https?:\/\//.test(line)) {
          bad.push(`${f}:${i + 1} ${line.trim()}`);
        }
      });
    }
    eq(bad, []);
  });

  // ── Font files resolve from the stylesheet, not the page ───────────────────
  // CSS url() is relative to the stylesheet. "../Assets/fonts/x.woff2" inside
  // Assets/fonts/fonts.css silently resolves to Assets/Assets/fonts/ and renders nothing.
  t("every font url() resolves", () => {
    const css = read("Assets/fonts/fonts.css");
    const missing = [...css.matchAll(/url\(["']?([^)"']+)["']?\)/g)]
      .map((m) => path.join("Assets/fonts", m[1]))
      .filter((p) => !exists(p));
    eq(missing, []);
  });

  // ── Favicons ───────────────────────────────────────────────────────────────
  // The pause page replaces the blocked tab. Without an icon the tab shows a generic
  // globe, which reads as a crash rather than as an intentional screen.
  t("tabbed pages declare a favicon that resolves", () => {
    const missing = [];
    for (const page of ["redirect/redirect.html", "onboarding/onboarding.html"]) {
      const icons = [...read(page).matchAll(/rel="icon"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
      if (!icons.length) { missing.push(`${page} → no favicon`); continue; }
      for (const href of icons) {
        const resolved = path.normalize(path.join(path.dirname(page), href));
        if (!exists(resolved)) missing.push(`${page} → ${href}`);
      }
    }
    eq(missing, []);
  });

  t("fonts.css declares faces for both families", () => {
    const css = read("Assets/fonts/fonts.css");
    ok(css.includes("Bricolage Grotesque"));
    ok(css.includes("DM Sans"));
  });

  // ── Model weights are vendored ─────────────────────────────────────────────
  t("model.json is bundled", () => ok(exists("vendor/nsfwjs/model/model.json")));

  t("every weight shard model.json names is present", () => {
    const model = JSON.parse(read("vendor/nsfwjs/model/model.json"));
    const shards = model.weightsManifest.flatMap((g) => g.paths);
    eq(shards.filter((s) => !exists(`vendor/nsfwjs/model/${s}`)), []);
  });

  t("offscreen loads the model from the bundle, not a CDN", () => {
    // Strip comments first — this file legitimately *documents* that a bare load()
    // falls back to CloudFront, and matching that sentence is not a finding.
    const src = read("offscreen/offscreen.js")
      .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    ok(src.includes("chrome.runtime.getURL"), "must resolve a local URL");
    notOk(/nsfwjs\.load\(\s*\)/.test(src), "bare load() falls back to CloudFront");
    ok(/nsfwjs\.load\(\s*MODEL_URL/.test(src), "must pass an explicit model URL");
  });

  // ── HTML / JS agreement ────────────────────────────────────────────────────
  for (const [js, html] of [
    ["popup/popup.js", "popup/popup.html"],
    ["redirect/redirect.js", "redirect/redirect.html"],
    ["onboarding/onboarding.js", "onboarding/onboarding.html"],
  ]) {
    t(`${path.basename(js)}: every element id it looks up exists`, () => {
      const src = read(js);
      const wanted = new Set([
        ...[...src.matchAll(/getElementById\(["']([^"']+)["']\)/g)].map((m) => m[1]),
        ...[...src.matchAll(/\bel\(["']([^"']+)["']\)/g)].map((m) => m[1]),
      ]);
      const have = new Set([...read(html).matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
      eq([...wanted].filter((id) => !have.has(id)), []);
    });
  }

  return t;
}
