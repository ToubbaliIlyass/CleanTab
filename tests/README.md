# Tests

```
node tests/run.mjs            # everything
node tests/run.mjs storage    # one suite, by filename fragment
```

No dependencies, no build step, no config. Exit code is non-zero on failure.

## What's here

| Suite | Covers |
|-------|--------|
| `domains` | `normalizeDomain`, `domainFromUrl`, trust matching and expiry |
| `keywords` | Word-boundary scoring; the Scunthorpe false-positive set |
| `scoring` | `getURLScore` passthrough-param handling, `riskLevel` |
| `thresholds` | Sensitivity profile ordering invariants |
| `ring` | `cleanShare`, `ringIsClosed`, the browsed-minutes floor |
| `review` | Appeal image parsing and the safe/unsafe/inconclusive verdict |
| `migrations` | v0→v1, v1→v2, chaining, idempotency |
| `storage` | Trust, block log, reflections, minute ticks, allowances, pauses, goal recalibration |
| `rollover` | Local-date keys, archiving, trimming, double-rollover safety |
| `bootstrap` | Fresh install, upgrades, partial profiles, repeated runs |
| `static` | Manifest integrity, bundle scope collisions, zero remote requests, asset paths |

## How it works

`shared/` files are plain scripts that declare globals — no module system, matching how
Chrome loads them. `harness.mjs` evaluates them into a fresh V8 context per suite with a
stubbed `chrome.storage` (async callbacks, like the real thing) and a frozen clock, so
date rollover and expiry are deterministic.

## What it does NOT cover

The service worker lifecycle, offscreen documents, TensorFlow.js, message routing,
`chrome.tabs`/`alarms`/`idle`, and every rendered pixel. That is **[MANUAL.md](MANUAL.md)** —
a 171-point checklist to run against a real Chrome profile.

## Adding a suite

Create `tests/<name>.test.mjs` with a default export returning the tester:

```js
import { createEnv, makeTester, eq, ok } from "./harness.mjs";

export default async function () {
  const t = makeTester("my suite");
  const { run, clock, local } = createEnv();
  t("does the thing", () => eq(run(`myFunction(1)`), 2));
  return t;
}
```

`createEnv()` returns `{ run, runAsync, clock, local, session, ctx }`. Use `clock.advance(ms)`
for anything time-dependent rather than real waiting.
