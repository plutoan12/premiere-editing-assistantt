#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FLAVOR="${1:-helper}"
node "$ROOT/scripts/build-rough-panel.mjs" "$FLAVOR"
command -v uxp >/dev/null || { echo "Adobe UXP CLI is required. Alternatively load dist/premiere-rough-$FLAVOR in UDT and use Actions > Package."; exit 1; }
mkdir -p "$ROOT/dist/ccx/$FLAVOR"
uxp plugin package --manifest "$ROOT/dist/premiere-rough-$FLAVOR/manifest.json" --outputPath "$ROOT/dist/ccx/$FLAVOR"
echo "Inspect the CCX in a disposable Premiere project before distribution."
