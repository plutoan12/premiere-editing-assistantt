# Helper transport / packaging status

## Implemented

- Versioned `@pea/helper-protocol` client/bootstrap contract.
- Release client accepts only HTTPS loopback endpoints; HTTP requires explicit development opt-in in the Node test client.
- Native helper binds only `127.0.0.1` on an ephemeral port.
- 256-bit random per-process session token; authenticated routes use Bearer auth and timing-safe token comparison.
- Health, transcription submit, job poll and cancellation endpoints.
- Canonical transcript bigint time is serialized as decimal strings.
- Premiere UXP panel can select a bootstrap JSON and permitted media file, submit it, poll progress, cancel, and display transcript text.
- Actual-model acceptance test is environment-gated; it never downloads a model or commits footage.
- macOS arm64 helper SEA build script and UXP packaging script are provided.

## Real-model acceptance command

Set all of these to local, user-controlled files:

- `PEA_TEST_FFMPEG`
- `PEA_TEST_WHISPER`
- `PEA_TEST_MODEL`
- `PEA_TEST_MEDIA`
- optional `PEA_TEST_LANGUAGE`
- optional `PEA_TEST_REFERENCE_TEXT`

Then run `pnpm --filter @pea/whisper-cpp test`. The acceptance test prints `PEA_REAL_MODEL_REPORT` with runtime and optional word error rate.

## Release blockers that tests cannot fake

1. macOS UXP blocks insecure HTTP. A release helper therefore requires a certificate chain trusted by the host/macOS; the checked-in panel refuses HTTP. No self-signed certificate is silently trusted or installed.
2. The actual model and user-owned footage are not in this repository. A real-model run must be executed on a machine where those files exist.
3. UXP packaging should be done with Adobe UDT/UXP CLI, not by renaming a ZIP.
4. The helper executable needs Developer ID signing/notarization for external distribution. The build script uses only an ad-hoc signature unless `PEA_CODESIGN_IDENTITY` is supplied.
5. Premiere host acceptance still requires loading the panel in Premiere and selecting the bootstrap/media files. Unit tests cannot establish that UXP networking and OS trust are configured correctly.
