#!/bin/bash
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  printf 'Node.js 22 이상을 먼저 설치해줘.\n'
  exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  printf 'FFmpeg와 ffprobe가 PATH에 있어야 해. 자동 다운로드는 하지 않아.\n'
  exit 1
fi
exec node "$HERE/pea-sync-helper/cli.cjs"
