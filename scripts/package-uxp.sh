#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/uxp"
mkdir -p "$OUT"
command -v uxp >/dev/null || {
  echo "Adobe UXP Developer Tool CLI ('uxp') is required."
  echo "Use UDT GUI Package if the CLI is unavailable on this Mac."
  exit 1
}
uxp plugin package --manifest "$ROOT/apps/premiere-panel/manifest.json" --outputPath "$OUT"
echo "CCX output: $OUT"
