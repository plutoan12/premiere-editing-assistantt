# @pea/whisper-cpp

Node-only local transcription provider. Never import this package into a UXP panel; a separate helper process and authenticated transport must host it.

`createWhisperCppProvider({ ffmpegPath, whisperPath, modelPath, language?, tempRoot?, timeoutMs?, maxJSONBytes?, maxAudioBytes? })` accepts explicit absolute paths to existing local binaries and a model. `transcribe({ mediaAssetId, mediaPath, signal? })` returns the shared Core Transcript.

Flow: validate local files -> unique temporary directory -> FFmpeg first audio stream to mono 16 kHz PCM WAV -> whisper-cli JSON -> validate millisecond offsets -> Core -> remove temporary directory in finally. No shell, source overwrite, download, network input, automatic translation, model installation, or paid API call. Speaker identity and word alignment are not inferred.

Processes have bounded combined logs and a shared transcription deadline (default 30 minutes). Cancellation sends SIGTERM then SIGKILL and awaits closure; POSIX uses a process group. Windows does not guarantee descendant termination. JSON defaults to a 16 MiB acceptance limit. Audio defaults to a 512 MiB post-decode acceptance limit, not a disk quota. Long-file windowing and disk reservation remain release work.

`parseWhisperCppJSON` consumes CLI `transcription[].offsets.from/to` as milliseconds, without multiplying by ten again. `runNativeProcess` is the tested shell-free runner.

Tests use deliberately fake CLI executables. Set `PEA_TEST_FFMPEG` to an installed FFmpeg absolute path to additionally exercise a real WAV conversion; the recognition response in that test remains a fixture. Actual model inference, Apple Silicon acceleration, speech quality, code signing, the helper transport and installer have NOT been verified by these tests.
