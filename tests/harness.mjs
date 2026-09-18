// Test harness for CleanTab's shared modules.
//
// The shared/ files are plain scripts that declare globals — no build step, no module
// system. So we evaluate them into a fresh V8 context per suite with a stubbed `chrome`,
// which is exactly how Chrome loads them (importScripts in the worker, <script> tags in
// pages, the manifest's js array in content scripts).
//
// Anything that needs a real browser — the service worker lifecycle, offscreen documents,
// message routing, rendering — is NOT covered here. See tests/MANUAL.md.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Load order mirrors the service worker's importScripts() list.
const SHARED = [
  "shared/dates.js",
  "shared/domains.js",
  "shared/thresholds.js",
  "shared/keywords.js",
  "shared/scoring.js",
  "shared/pageshape.js",
  "shared/nano.js",
  "shared/review.js",
  "shared/schema.js",
  "shared/lock.js",
  "shared/migrations/v0_to_v1.js",
  "shared/migrations/v1_to_v2.js",
  "shared/storage.js",
];

function makeStorageArea() {
  const store = {};
  return {
    _store: store,
    get(keys, cb) {
      let out;
      if (keys === null || keys === undefined) out = { ...store };
      else if (Array.isArray(keys)) {
        out = {};
        for (const k of keys) if (k in store) out[k] = store[k];
      } else if (typeof keys === "string") {
        out = keys in store ? { [keys]: store[keys] } : {};
      } else {
        out = { ...keys };
        for (const k of Object.keys(keys)) if (k in store) out[k] = store[k];
      }
      // Chrome's storage callbacks are always async; making them sync here would hide
      // ordering bugs that only show up in the real extension.
      queueMicrotask(() => cb(structuredClone(out)));
    },
    set(updates, cb) {
      Object.assign(store, structuredClone(updates));
      queueMicrotask(() => cb && cb());
    },
    remove(keys, cb) {
      for (const k of [].concat(keys)) delete store[k];
      queueMicrotask(() => cb && cb());
    },
  };
}

// Freezes "now" so date rollover and expiry logic are deterministic.
function makeClock(startMs) {
  let now = startMs;
  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(now);
      else super(...args);
    }
    static now() { return now; }
  }
  return {
    Date: FakeDate,
    set(ms) { now = ms; },
    advance(ms) { now += ms; },
    get() { return now; },
  };
}

export function createEnv({ now = Date.parse("2026-09-16T12:00:00") } = {}) {
  const local = makeStorageArea();
  const session = makeStorageArea();
  const clock = makeClock(now);

  const sandbox = {
    console,
    chrome: { storage: { local, session } },
    URL, URLSearchParams, structuredClone, queueMicrotask,
    // shared/lock.js hashes the partner passphrase with SubtleCrypto.
    crypto, TextEncoder, TextDecoder, Uint8Array,
    Math, Object, Array, String, Number, JSON, Set, Map, WeakMap, WeakSet,
    Promise, RegExp, Boolean, Error, Symbol, isNaN, parseInt, parseFloat,
    Date: clock.Date,
  };

  const ctx = vm.createContext(sandbox);
  for (const file of SHARED) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), ctx, { filename: file });
  }

  return {
    ctx,
    clock,
    local,
    session,
    /** Evaluate an expression against the loaded modules. */
    run: (src) => vm.runInContext(src, ctx),
    /** Evaluate an async expression and await it. */
    runAsync: (src) => vm.runInContext(`(async () => { ${src} })()`, ctx),
  };
}

// ── Assertions ────────────────────────────────────────────────────────────────

export function makeTester(suiteName) {
  const results = [];

  const t = (name, fn) => {
    try {
      const r = fn();
      if (r && typeof r.then === "function") {
        return r.then(
          () => results.push({ name, ok: true }),
          (err) => results.push({ name, ok: false, err }),
        );
      }
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, err });
    }
  };

  t.suite = suiteName;
  t.results = results;
  return t;
}

export function eq(actual, expected, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n    expected: ${e}\n    actual:   ${a}`);
}

export function ok(value, msg = "expected truthy") {
  if (!value) throw new Error(`${msg} (got ${JSON.stringify(value)})`);
}

export function notOk(value, msg = "expected falsy") {
  if (value) throw new Error(`${msg} (got ${JSON.stringify(value)})`);
}

export function close(actual, expected, tolerance = 1e-9, msg = "") {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${msg}\n    expected: ~${expected}\n    actual:   ${actual}`);
  }
}
