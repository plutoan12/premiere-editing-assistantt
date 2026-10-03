# @pea/native-helper

Local transcription helper for Premiere Editing Assistant.

## Security boundary

- Binds only to `127.0.0.1` on an ephemeral port.
- Generates a random 256-bit session token at each start.
- All `/v1/*` routes require `Authorization: Bearer <token>`.
- TLS is mandatory unless `allowInsecureDev` / `PEA_ALLOW_INSECURE_DEV=1` is explicitly selected for development.
- Source media is passed to the existing shell-free FFmpeg/whisper.cpp provider and is never overwritten.

## CLI environment

Required:

- `PEA_FFMPEG=/absolute/path/to/ffmpeg`
- `PEA_WHISPER=/absolute/path/to/whisper-cli`
- `PEA_MODEL=/absolute/path/to/ggml-model.bin`
- `PEA_BOOTSTRAP=/absolute/path/to/helper-bootstrap.json`

Release TLS additionally requires:

- `PEA_TLS_KEY=/absolute/path/to/key.pem`
- `PEA_TLS_CERT=/absolute/path/to/cert.pem`

The certificate must be trusted by macOS/Premiere and valid for the loopback hostname/IP used by the bootstrap endpoint. The project does not silently install a local CA.

For an explicitly insecure development-only Node test run, set `PEA_ALLOW_INSECURE_DEV=1`. This is intentionally incompatible with the checked-in Premiere release manifest on macOS.

## Build

On macOS arm64 with Node 25.5+:

```sh
bash scripts/build-helper-macos.sh
```

Without `PEA_CODESIGN_IDENTITY`, the build receives only an ad-hoc development signature. Distribution requires a Developer ID signature and notarization.
