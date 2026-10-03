#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/helper-macos-arm64"
mkdir -p "$OUT"
command -v node >/dev/null || { echo "node is required"; exit 1; }
command -v pnpm >/dev/null || { echo "pnpm is required"; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 25 ]; then
  echo "Node 25.5+ is required for built-in --build-sea packaging."
  exit 1
fi
pnpm exec esbuild "$ROOT/apps/native-helper/src/cli.ts" --bundle --platform=node --format=esm --outfile="$OUT/pea-helper.mjs"
cat > "$OUT/sea-config.json" <<JSON
{
  "main": "$OUT/pea-helper.mjs",
  "mainFormat": "module",
  "output": "$OUT/pea-helper",
  "disableExperimentalSEAWarning": true,
  "useSnapshot": false,
  "useCodeCache": false
}
JSON
node --build-sea "$OUT/sea-config.json"
chmod +x "$OUT/pea-helper"
if [ -n "${PEA_CODESIGN_IDENTITY:-}" ]; then
  codesign --force --options runtime --timestamp --sign "$PEA_CODESIGN_IDENTITY" "$OUT/pea-helper"
else
  codesign --force --sign - "$OUT/pea-helper"
  echo "Development ad-hoc signature applied. Release requires Developer ID + notarization."
fi
echo "$OUT/pea-helper"
