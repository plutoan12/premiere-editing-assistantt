#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ "$(uname -s)" == "Darwin" ]] || { echo "A real macOS SDK is required."; exit 1; }
ARCH="${PEA_NATIVE_ARCH:-$(uname -m)}"
[[ "$ARCH" == "arm64" || "$ARCH" == "x86_64" ]] || { echo "Unsupported architecture"; exit 1; }
ARGS=(-DCMAKE_BUILD_TYPE=Release "-DCMAKE_OSX_ARCHITECTURES=$ARCH")
[[ -z "${PEA_UXP_SDK:-}" ]] || ARGS+=("-DPEA_UXP_SDK=$PEA_UXP_SDK")
cmake -S "$ROOT/native/avfoundation" -B "$ROOT/dist/native-$ARCH" "${ARGS[@]}"
cmake --build "$ROOT/dist/native-$ARCH" --config Release
if [[ -f "$ROOT/dist/native-$ARCH/pea-media.uxpaddon" ]]; then
 lipo -verify_arch "$ARCH" "$ROOT/dist/native-$ARCH/pea-media.uxpaddon"
 echo "Unsigned development binary built. Developer ID signing/notarization and Premiere testing remain required."
else
 echo "AVFoundation CLI built. Set PEA_UXP_SDK to build the real Hybrid addon."
fi
