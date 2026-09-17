#!/usr/bin/env node
// Zero-dependency test runner.  node tests/run.mjs [suite-name-filter]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2];

const files = fs.readdirSync(DIR)
  .filter((f) => f.endsWith(".test.mjs"))
  .filter((f) => !filter || f.includes(filter))
  .sort();

let passed = 0;
let failed = 0;
const failures = [];

for (const file of files) {
  const mod = await import(path.join(DIR, file));
  const t = await mod.default();
  const suitePass = t.results.filter((r) => r.ok).length;
  const suiteFail = t.results.filter((r) => !r.ok);

  const status = suiteFail.length ? "FAIL" : " ok ";
  console.log(`${status}  ${t.suite.padEnd(28)} ${suitePass}/${t.results.length}`);

  for (const f of suiteFail) {
    console.log(`        ✗ ${f.name}`);
    console.log(`          ${String(f.err.message).split("\n").join("\n          ")}`);
    failures.push(`${t.suite} › ${f.name}`);
  }

  passed += suitePass;
  failed += suiteFail.length;
}

console.log(`\n${passed} passed, ${failed} failed, ${files.length} suites`);
if (failed) {
  console.log("\nFailing:");
  failures.forEach((f) => console.log(`  ${f}`));
}
process.exit(failed ? 1 : 0);
