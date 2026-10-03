# @pea/native-helper

Local-only media helper for Premiere Editing Assistant.

- Binds to `127.0.0.1` only.
- Uses a random per-process bearer token for `/v1/*`.
- Runs FFmpeg/ffprobe with argv and `shell:false`.
- Does not download FFmpeg, modify source media, or require a cloud service.
- `FfmpegAudioSampleProvider` supplies bounded mono Float32 PCM to `@pea/sync`.
- Current job registry is in-memory only; restart recovery is intentionally not claimed.

Development expects `ffmpeg` and `ffprobe` on PATH for system integration tests. Unit tests do not require them.
