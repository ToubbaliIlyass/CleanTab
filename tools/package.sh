#!/bin/sh
# Builds the zip to upload to the Chrome Web Store: only what the extension loads at
# runtime. Docs, tests, design files and the signing key stay out.
#
#   sh tools/package.sh        ->  dist/cleantab-<version>.zip
set -e
cd "$(dirname "$0")/.."

node tests/run.mjs >/dev/null || { echo "Tests are failing; not packaging."; exit 1; }

VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/cleantab-$VERSION.zip"
mkdir -p dist
rm -f "$OUT"

zip -r -q -X "$OUT" \
  manifest.json managed_schema.json background.js content.js \
  LICENSE THIRD-PARTY-NOTICES.md \
  Assets offscreen onboarding popup redirect shared vendor \
  -x "*.DS_Store" -x "vendor/SETUP.md" -x "Assets/mascot/*.md"

echo "$OUT  ($(du -h "$OUT" | cut -f1))"
unzip -l "$OUT" | tail -1
