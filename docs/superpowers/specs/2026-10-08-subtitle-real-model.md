# Subtitle — actual local model acceptance

Date: 2026-10-08 (Asia/Seoul). JSON report timestamps use UTC.

## Result and scope

The existing `createWhisperCppProvider` successfully decoded permitted synthetic audio with FFmpeg and transcribed it with the real multilingual Whisper `base` model. This exercises the production adapter's local executable path, JSON parsing, canonical transcript conversion, and monotonic segment timing checks. It uses no paid API, private media upload, global installation, or additional voice download.

Environment: macOS 27.2 build 26B5101f, arm64, Apple M3 Max, Apple clang 21.0.0. The successful diagnostic log identifies the Apple M3 Max Metal device and completes inference. It is at `build/deps/subtitle/reports/metal-runtime-verified.log`.

| Sample | Audio duration | Accepted fixture warm elapsed | Normalized CER | Normalized WER | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Korean, installed macOS Yuna voice | 10.955510 s | 334 ms | 0/51 = 0% | 0/16 = 0% | 2 segments; punctuation differs from reference |
| English, installed macOS Samantha voice | 9.641678 s | 312 ms | 2/113 = 1.77% | 1/24 = 4.17% | 2 segments; `dialogue` recognized as `dialog` |

The table refers to `reports/ko-base-premiere.json` and `reports/en-base-warm.json`. Elapsed time covers FFmpeg decoding and whisper.cpp inference, excluding report hashing and test runner startup. Their real-time factors are approximately 0.0305 Korean and 0.0324 English. These are individual observations, not a throughput benchmark.

The first Korean execution took **18,854 ms** (`reports/ko-base.json`), compared with 335 ms on a later run (`reports/ko-base-warm.json`) and 334 ms on the final Premiere fixture run (`reports/ko-base-premiere.json`). The first execution has cold-start characteristics, but OS/Metal caches were not explicitly cleared; the cause of its additional latency was not isolated. A separate English cold run was not measured. Its initial already-warm run took 322 ms (`reports/en-base.json`), and the final warm run took 312 ms (`reports/en-base-warm.json`). The initial reports predate the FFmpeg version-metadata correction described below and retain their original binary hashes; the final warm reports match `provenance.json`.

CER uses NFKC-normalized Unicode code points after lowercasing and removing punctuation/whitespace. Korean syllables count as characters. WER uses normalized whitespace tokens, so Korean WER is based on eojeol boundaries, not linguistic word segmentation. Case and punctuation differences do not count as errors. The four metric unit tests cover substitution, omission, Korean composition/spacing, and an empty normalized reference.

These are short, clean, single-speaker **TTS samples**. They establish real model execution and measured sample accuracy. They do not establish quality on natural conversations, background music/noise, dialects, multiple speakers, long media, diarization, word alignment, or segment-boundary accuracy against human annotations. The acceptance test requires nonempty, ordered segments; its CER/WER output is a measurement, not a production quality threshold. Premiere caption application is a separate host acceptance step.

## Pinned sources and local artifacts

The setup script verifies SHA-256 before extracting or executing downloads. All downloaded sources, tools, model weights, generated media, and reports remain under ignored `build/deps/subtitle/`.

| Component | Official source and revision | Download SHA-256 |
| --- | --- | --- |
| whisper.cpp v1.9.4 | [Release](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.4), commit `927cfce34f31707e17f2bff35c349632fb9e2c3a` | `41b664fee09e79176ac277b5237debec34f8d74af3c7d71f333f1ec67989ecde` |
| FFmpeg n9.0.2 | [Official mirror](https://github.com/FFmpeg/FFmpeg/tree/946fcce07b6dcd0331c8cc609192aeff5e1924f8), commit `946fcce07b6dcd0331c8cc609192aeff5e1924f8` | `0aa2b1de2a5698b20a23e93d539a9a8e82ca0117496c5bdf05d198805f42bb3b` |
| CMake 4.4.4 | [Official macOS universal release](https://github.com/Kitware/CMake/releases/tag/v4.4.4) | `4b7b73704b1db9b374e5c9ab8e17ac6148b817b6396ee75cd94a852cbac9d305` |
| Multilingual `ggml-base.bin` | [ggerganov/whisper.cpp model](https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1), revision `5359861c739e955e79d9a303bcbc70fb988958b1` | `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe` |

The code and weights are separate inputs: whisper.cpp code uses [MIT](https://github.com/ggml-org/whisper.cpp/blob/927cfce34f31707e17f2bff35c349632fb9e2c3a/LICENSE); the [GGML model card](https://huggingface.co/ggerganov/whisper.cpp/blob/5359861c739e955e79d9a303bcbc70fb988958b1/README.md) declares MIT, consistent with the [original Whisper code/model weights license](https://github.com/openai/whisper#license). This locally compiled FFmpeg reports LGPL 2.1 or later. Its build disables autodetection, documentation, debug output, network protocols, and ffplay, with no external codec library or GPL option enabled.

| Local artifact, relative to `build/deps/subtitle/` | SHA-256 |
| --- | --- |
| `whisper-build/bin/whisper-cli` | `382852425dc158f9b7a16f8f2ec56885d55f1cc71db8d99cd6ffdff73d5ecfb9` |
| `ffmpeg/bin/ffmpeg` | `0541e47e42abe3e2db473a7bdf02cf226f6c6500e0b28f328dc926a3bfb79097` |
| `ffmpeg/bin/ffprobe` | `273b9a33b2515eefb8aad6ee8fe225eb3438133b7e9489dbc35f9de99fa08b75` |
| `models/ggml-base.bin` (147,951,465 bytes) | `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe` |
| `fixtures/ko-yuna.aiff` | `99c6f3e2acf35f7e060be777faedcdbe1270280cdf345ea86021250cb04ab965` |
| `fixtures/en-samantha.aiff` | `691a92ba995f24ddc274fe95d41d1e3c7e1cb730ed3a53bc0c01d45c4f71c634` |

`build/deps/subtitle/provenance.json` records the exact URLs, source archive/model hashes, generated paths, FFmpeg configuration, binary versions, and hashes of the six locally built whisper/ggml dynamic libraries. `whisper-cli` is dynamically linked to those libraries; retain the build directory with it. Binary hashes are local build evidence, not a promise of bit-identical output from other compiler/OS versions.

The pinned whisper release reports `whisper.cpp version: 1.9.4-dev`; the manifest preserves that literal output. The FFmpeg GitHub archive omits `VERSION`; setup generates `VERSION` containing `9.0.2` so its build does not mistakenly discover the enclosing application's Git revision. This generated metadata is also recorded in the manifest.

An intermediate diagnostic overlapped an earlier setup run that copied over an existing model and failed to load the temporarily incomplete file. Setup now validates and reuses an existing model, and installs a new model through a verified temporary file plus rename. Cached setup, subsequent acceptance runs, and the final Metal diagnostic all succeeded after that correction.

## Existing local evidence

These files are local ignored artifacts, not checked into Git. Paths below are relative to the repository root so the shared document contains no workstation-specific absolute path.

| Evidence | Path |
| --- | --- |
| Dependencies, source URLs/hashes, binary/library hashes | `build/deps/subtitle/provenance.json` |
| Synthetic voice names, exact generation arguments, input hashes | `build/deps/subtitle/fixture-provenance.json` |
| Final Korean actual-model metrics and exact transcript path | `build/deps/subtitle/reports/ko-base-premiere.json` |
| Final English actual-model metrics | `build/deps/subtitle/reports/en-base-warm.json` |
| Korean canonical transcript with decimal-string ticks | `build/deps/subtitle/reports/ko-base-premiere.transcript.json` |
| Sequence-start-zero SubtitleDocument | `build/deps/subtitle/fixtures/ko-yuna-actual.sequence.subtitle.json` |
| Sequence-start-zero SRT | `build/deps/subtitle/fixtures/ko-yuna-actual.sequence.srt` |
| Fixture lineage, output hashes, unchanged cue times | `build/deps/subtitle/reports/ko-yuna-actual.sequence.evidence.json` |

The Premiere fixture label is `실제 Whisper base 모델 검증 · 한국어 합성 음성 Yuna`. Its sequence origin starts at zero. The actual model's cues remain **0–4.560 seconds** and **4.560–10.760 seconds**, including recognized punctuation and leading spaces. Creating, serializing, reopening, and exporting the document passed an exact transcript equality assertion. The original `fixtures/ko-yuna.aiff` is unchanged. Human annotation of those boundaries was not performed.

## Reproduce dependencies and acceptance

Run from the repository root on macOS arm64 with Apple clang/make and the existing workspace dependencies. Setup is explicit; `--help` and invocation without arguments do not download or build anything.

```sh
node scripts/setup-subtitle-model.mjs --setup
export SUBTITLE_DEPS="$PWD/build/deps/subtitle"
export SUBTITLE_RUN_DIR="$(mktemp -d "$SUBTITLE_DEPS/reports/replay.XXXXXX")"
/usr/bin/say -v '?'
```

The following voices were already installed on the verified machine. Use their exact displayed names on that machine; this procedure does not download voices. Each replay uses a new directory so evidence is not overwritten. OS/voice versions can change generated bytes and model output.

```sh
/usr/bin/say -v 'Yuna (한국어(한국))' -r 150 -o "$SUBTITLE_RUN_DIR/ko-yuna.aiff" \
  '안녕하세요. 오늘은 편집한 영상의 자막을 확인합니다. 원본 대사를 검색하고, 잘못된 단어를 고친 다음, 자막 파일을 저장합니다.'
/usr/bin/say -v 'Samantha (영어(미국))' -r 150 -o "$SUBTITLE_RUN_DIR/en-samantha.aiff" \
  'Hello. Today we are checking the subtitles for an edited video. We find the original dialogue, correct the words, and save the subtitle file.'

PEA_TEST_FFMPEG="$SUBTITLE_DEPS/ffmpeg/bin/ffmpeg" \
PEA_TEST_FFPROBE="$SUBTITLE_DEPS/ffmpeg/bin/ffprobe" \
PEA_TEST_WHISPER="$SUBTITLE_DEPS/whisper-build/bin/whisper-cli" \
PEA_TEST_MODEL="$SUBTITLE_DEPS/models/ggml-base.bin" \
PEA_TEST_MEDIA="$SUBTITLE_RUN_DIR/ko-yuna.aiff" \
PEA_TEST_LANGUAGE=ko \
PEA_TEST_REFERENCE_TEXT='안녕하세요. 오늘은 편집한 영상의 자막을 확인합니다. 원본 대사를 검색하고, 잘못된 단어를 고친 다음, 자막 파일을 저장합니다.' \
PEA_TEST_INCLUDE_TEXT=1 \
PEA_TEST_TRANSCRIPT_PATH="$SUBTITLE_RUN_DIR/ko.transcript.json" \
PEA_TEST_REPORT_PATH="$SUBTITLE_RUN_DIR/ko.json" \
pnpm --filter @pea/whisper-cpp exec vitest run src/actual-model.acceptance.test.ts

PEA_TEST_FFMPEG="$SUBTITLE_DEPS/ffmpeg/bin/ffmpeg" \
PEA_TEST_FFPROBE="$SUBTITLE_DEPS/ffmpeg/bin/ffprobe" \
PEA_TEST_WHISPER="$SUBTITLE_DEPS/whisper-build/bin/whisper-cli" \
PEA_TEST_MODEL="$SUBTITLE_DEPS/models/ggml-base.bin" \
PEA_TEST_MEDIA="$SUBTITLE_RUN_DIR/en-samantha.aiff" \
PEA_TEST_LANGUAGE=en \
PEA_TEST_REFERENCE_TEXT='Hello. Today we are checking the subtitles for an edited video. We find the original dialogue, correct the words, and save the subtitle file.' \
PEA_TEST_INCLUDE_TEXT=1 \
PEA_TEST_REPORT_PATH="$SUBTITLE_RUN_DIR/en.json" \
pnpm --filter @pea/whisper-cpp exec vitest run src/actual-model.acceptance.test.ts
```

The optional report and transcript outputs use exclusive file creation. Choose a new output path for each run. The transcript contains exact decimal-string ticks, never JSON numbers for bigint time. `PEA_TEST_INCLUDE_TEXT=1` includes the permitted synthetic reference and recognized text in the report. Model test execution remains opt-in through all four executable/model/media environment variables.

## Reproduce the Premiere fixture from an actual result

After the Korean command above, the following one-off test uses the existing document library. It reads that actual transcript, preserves its text and times, creates a sequence-origin document starting at zero, verifies JSON reopening, and writes SRT plus separate lineage evidence. It performs no Premiere action. The temporary test source is moved beside the evidence afterwards so normal test discovery will not rerun an exclusive file write.

```sh
cat > "$SUBTITLE_DEPS/export-fixture.replay.test.ts" <<'EOF'
import { test, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { TranscriptSchema } from '../../../packages/core/src/index.ts';
import { createSubtitleDocument, currentTranscript, exportSubtitleDocument,
  parseSubtitleDocument, serializeSubtitleDocument } from '../../../packages/transcript/src/index.ts';

test('exports unchanged actual-model cues for a sequence starting at zero', async () => {
  const output = process.env.SUBTITLE_RUN_DIR!;
  const dependencies = process.env.SUBTITLE_DEPS!;
  const reportPath = `${output}/ko.json`;
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const transcript = TranscriptSchema.parse(JSON.parse(
    await readFile(report.transcriptPath, 'utf8'),
    (key, value) => key === 'ticks' ? BigInt(value) : value
  ));
  const label = '실제 Whisper base 모델 검증 · 한국어 합성 음성 Yuna';
  const document = createSubtitleDocument({
    id: 'actual-model-ko-yuna-sequence', source: 'whisper-cpp', transcript,
    createdAt: report.startedAt,
    origin: {
      kind: 'sequence', mediaAssetId: 'acceptance-media', label,
      inputRevision: `sha256:${report.sha256.media}`,
      timelineStart: { ticks: 0n, timebase: { numerator: 1, denominator: 1000 } }
    }
  });
  const json = serializeSubtitleDocument(document) + '\n';
  const reopened = parseSubtitleDocument(json);
  expect(currentTranscript(reopened)).toEqual(transcript);
  const srt = exportSubtitleDocument(reopened, 'srt');
  const documentPath = `${output}/ko-yuna-actual.sequence.subtitle.json`;
  const srtPath = `${output}/ko-yuna-actual.sequence.srt`;
  await writeFile(documentPath, json, { flag: 'wx' });
  await writeFile(srtPath, srt, { flag: 'wx' });
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const evidence = {
    label, actualModelReportPath: reportPath, actualTranscriptPath: report.transcriptPath,
    dependencyProvenancePath: `${dependencies}/provenance.json`,
    originalSyntheticMediaPath: report.paths.media, modelSHA256: report.sha256.model,
    method: 'Actual model text and segment times unchanged; sequence start zero.',
    document: { path: documentPath, sha256: hash(json) },
    srt: { path: srtPath, sha256: hash(srt) },
    cueTimes: transcript.segments.map(cue => ({
      id: cue.id, start: cue.range.start, duration: cue.range.duration
    }))
  };
  await writeFile(`${output}/ko-yuna-actual.sequence.evidence.json`,
    JSON.stringify(evidence, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n',
    { flag: 'wx' });
});
EOF
pnpm exec vitest run "$SUBTITLE_DEPS/export-fixture.replay.test.ts"
mv "$SUBTITLE_DEPS/export-fixture.replay.test.ts" "$SUBTITLE_RUN_DIR/export-fixture.test.ts.evidence"
```

## Regression verification

Observed scoped results: whisper adapter 21 passed/1 opt-in model test skipped during its ordinary suite; actual Korean and English runs each 5/5 passed; quality metric regressions first failed then passed; rough-media 9/9 passed with the local FFmpeg/FFprobe; whisper adapter typecheck and setup script syntax/help/cache reuse checks passed. The actual-result document/SRT export test also passed. No rough-media code/test changes were needed for its earlier two `ENOENT` failures.

The documented voice generation, actual-model commands, and fixture export command were then executed verbatim in `build/deps/subtitle/reports/replay.RCkxHp/`: both languages passed 5/5 and the fixture export passed 1/1. This replay measured 320 ms Korean and 282 ms English with unchanged CER/WER and identical synthetic input hashes. It confirms the documented procedure; the original Premiere fixture/evidence paths above were retained.

Run all workspace checks with explicit native executable paths. The removed model/media environment variables prevent an inherited opt-in test configuration from reusing exclusive report paths during the general suite:

```sh
env -u PEA_TEST_WHISPER -u PEA_TEST_MODEL -u PEA_TEST_MEDIA \
  PEA_TEST_FFMPEG="$PWD/build/deps/subtitle/ffmpeg/bin/ffmpeg" \
  PEA_TEST_FFPROBE="$PWD/build/deps/subtitle/ffmpeg/bin/ffprobe" \
  pnpm test
pnpm typecheck
```

Workspace totals and live Premiere outcomes belong in the [workflow acceptance record](2026-10-07-subtitle-review-acceptance.md); the evidence here covers local model inference and its exported fixture.
