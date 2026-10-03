# @pea/native-helper 0.1.2

Development-only local media and Sync service. Reuses @pea/core and @pea/sync; no source-media writes, required cloud services, paid model calls or automatic binary downloads. This is not a signed macOS application or an installed UXP plugin.

## Run with the UXP panel

Use Node 22, pnpm and separately installed FFmpeg/ffprobe. Supply a certificate trusted by the user's operating system, with IP SAN 127.0.0.1, and its private key (POSIX 0600). No certificate, private key or CA is included or automatically installed.

```sh
pnpm install
PEA_TLS_KEY="/absolute/private/localhost-key.pem" \
PEA_TLS_CERT="/absolute/private/localhost-cert.pem" \
pnpm --filter @pea/native-helper start
```

The CLI requires TLS by default. For the old HTTP-only development clients, explicitly set `PEA_ALLOW_HTTP=1`; the UXP panel rejects those plaintext sessions. A partially configured TLS pair never downgrades to HTTP. `PEA_FFMPEG_PATH` and `PEA_FFPROBE_PATH` optionally select installed executables.

One `ready` event prints the private session-file path, not the token. The 0600 session JSON inside a 0700 temporary directory contains `address`, `sessionToken` and integer `protocolVersion: 1`. Ctrl+C/SIGTERM closes jobs/decoders and deletes only the helper-owned session file. Do not commit or share that file.

Panel instructions: `../premiere-sync-panel/README.md`.

## Protocol v1

Only literal IPv4 loopback 127.0.0.1 is bound, using an ephemeral port. Every `/v1/*` route requires `Authorization: Bearer <sessionToken>`. JSON requests use uncompressed application/json. A supplied `X-PEA-Protocol-Version` must be `1`. Browser Origin headers and unexpected Host headers are rejected; wildcard CORS is not enabled.

| Route | Behavior |
| --- | --- |
| GET /health | Public status/version; no token |
| GET /v1/ping | Authenticated version/capability handshake |
| POST /v1/media/probe | `{ "path": "/absolute/source.mov" }` |
| POST /v1/audio/window | `{ "path": "/absolute/source.mov", "startSample": "0", "maxSamples": 16000, "sampleRate": 8000 }` |
| POST /v1/jobs | `{ "kind": "media-probe" or "audio-window" or "sync", "input": { ... } }` |
| GET /v1/jobs/:id | Bounded state/result metadata |
| GET /v1/jobs/:id/audio | Binary PCM for a completed audio-window job |
| POST /v1/jobs/:id/cancel | Idempotent cancel; already completed/failed returns 409 |
| DELETE /v1/jobs/:id | 204 after terminal cleanup; unfinished work returns 409 |

Sync input has `referenceClipId`, `sampleRate`, `maxSamples` and 2..16 `clips`, each `{clipId,path,startSample}`. Start samples are decimal strings. Sync rates are 8000, 16000 or 48000 and maximum window size is 262144 samples. The same explicit reference is used for every target. Results preserve matched/partial/review, canonical evidence and exact decimal-string time values. PCM is never returned inside a Sync JSON result. Per-decoded-window hashes are recorded, not a guarantee that entire files stayed unchanged externally.

Audio responses are mono f32le application/octet-stream with X-PEA-Format, X-PEA-Sample-Rate, X-PEA-Start-Sample, X-PEA-Sample-Count and X-PEA-Content-SHA256. Read little-endian floats explicitly.

## Bounds and limitations

JSON input is capped at 65536 bytes. PCM windows are at most 1 MiB. At most two media operations and sixteen retained jobs are allowed; terminal jobs must be deleted to reclaim capacity. Jobs are in-memory, not restart-persistent. FFprobe defaults to a 10-second timeout, decoding to 30 seconds, and a Sync batch to a 120-second deadline. Cancellation retains decoder ownership until child cleanup finishes. The bounded correlation FFT itself is synchronous in the Helper, not the UXP UI.

Only regular absolute local media files and approved input protocols/demuxers are accepted. This is not an OS sandbox against same-user programs. Remote media inputs/playlists and unsupported stream origins are rejected. Raw process stderr/private paths are not returned in protocol errors.

Decoder policy is still `ffmpeg-local/2`: downmix/resample from decoded origin with async=0, then trim exact output sample counts. This keeps later windows consistent with earlier windows but may be slow for late windows. Full-recording window search and drift correction are not implemented. Sync offsets are relative to original file zero, not Premiere In/Out/subclip/timeline ranges.

## Verification

`pnpm test` runs workspace tests including required actual FFmpeg integration. Missing FFmpeg fails rather than silently skipping. `pnpm typecheck` runs TypeScript package checks. The UXP panel has separate Node behavior tests and JavaScript syntax checks; it is not TypeScript-checked.

The panel-client TLS integration test uses a generated private fixture certificate only in that test request, not a verification bypass or system trust-store write. Generated WAV/MOV tests are not real production-footage accuracy evidence.

Remaining host gates: real Premiere loading/rendering/selection, TLS trust, arbitrary-port manifest permissions, actual UXP Origin behavior, user camera/recorder footage, timeline dry-run/Apply, signed installation/relaunch/uninstall. See the Sync panel README for the manual acceptance boundary.
