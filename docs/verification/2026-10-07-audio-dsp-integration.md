# Audio Engine / DSP 통합 검증

상태: 로컬 구현·코드 리뷰·실제 FFmpeg 통합 검증 완료. 전체 207개 테스트 통과, 실패/건너뜀 없음.

## 작업 범위

- 기준: PR #13 head `f079854d383b391cbcd50ec273f5da94b2503c50`.
- 별도의 `audio-dsp-integration` 작업 트리에서 구현·검증.
- 기존 Audio 작업 공간 및 다른 작업 트리는 그대로 보존.
- 사용자 요청에 따라 기존 PR #13의 `feat/audio-dsp-provider` 브랜치에 반영하는 변경이다.
  로컬 검증 결과는 아래와 같으며, 원격 CI 결과는 [PR 체크](https://github.com/plutoan12/premiere-editing-assistantt/pull/13/checks)에서 확인한다. 병합은 범위에 포함하지 않는다.

## 변경

- `audio-measure` / `audio-normalize`를 기존 인증된 HTTP 작업 큐에 등록.
- 출력 경로는 서버 옵션과 `PEA_AUDIO_OUTPUT_ROOT`로만 설정하며 요청별 임의 경로는 차단.
- 기존 `@pea/audio` 패키지 통합. 전체 선택 스트림의 실제 LUFS/true-peak를
  Audio Engine artifact 및 정규화 제안으로 전달하는 FFmpeg provider 추가.
- SHA-256, 범위, 샘플 수·샘플레이트, 채널 순서, 스트림 및 런타임 일치 여부 검증.
- 스트림·모노 처리 정책·런타임 빌드별 캐시 분리. 잘린 구간과 모호한 시간 원점은 거부.
- 리뷰에서 발견한 CRLF 버전 문자열 불일치 수정 및 회귀 테스트 추가.

## 확인 결과

환경: macOS arm64, Node 24.18.1, 저장소 지정 pnpm 10.17.1.

사용자 승인 후 `/tmp/pea-audio-dsp-tools.mNQ2H2`에 검증 도구를 설치했다.

- `@ffmpeg-installer/darwin-arm64@4.1.5`의 FFmpeg 4.4
- `@ffprobe-installer/darwin-arm64@5.0.1`의 FFprobe n4.4.1

npm lifecycle scripts를 실행하지 않고 바이너리에만 실행 권한을 부여했다.
프로젝트 의존성과 시스템 PATH 설정은 변경하지 않았다. 테스트 명령에만
임시 폴더의 `bin` 경로를 추가했다. 이 폴더는 재현용으로 남겨 두었으며,
운영체제에서 임시 폴더를 제거하면 도구를 다시 준비해야 한다.

| 검증 | 결과 |
| --- | --- |
| 수정 전 신규 HTTP 회귀 테스트 | 2개 모두 실패: 기대 202, 실제 400 |
| 수정 전 전체 타입 검사 | 출력 옵션 누락 및 기존 HTTP 테스트 TS7022 오류 |
| 고정 lockfile 설치 (`CI=true ... pnpm install --frozen-lockfile --ignore-scripts`) | 성공 |
| `pnpm typecheck` | Core / Sync / Audio / native-helper 모두 성공 |
| `pnpm test` 전체 실행 | **207개 통과**: Core 13 + Sync 51 + Audio 52 + helper 91. 실패/건너뜀 없음 |
| 실제 FFmpeg/FFprobe 필요 테스트 | **24개 통과**: helper 통합 7 + DSP 통합 14 + DSP HTTP 1 + Audio Engine 브리지 2 |
| `git diff --check` | 성공 |
| 별도 코드 리뷰 | Critical/Important 지적 없음. CRLF 지적 수정 후 재검증 완료 |
| 설치 전 `pnpm test` 실행 시도 | 실행 파일 부재로 실패했으나, 승인된 설치 후 전체 재실행 성공 |

최종 실행 시각은 2026-10-07 22:23 KST이며, `pnpm test`와 `pnpm typecheck`는
모두 종료 코드 0을 반환했다. FFmpeg 필수 테스트를 제외하거나 건너뛰지 않았다.
실제 스테레오/다중 스트림 측정, 무음, 모노 정책, 5.1 레이아웃, 정규화 후 재측정,
샘플 수 보존, 원본·이전 산출물 보존, 취소 및 실패 정리를 확인했다.
Sync 회귀 검증에서도 ±1487 샘플 오프셋을 정확하게 복원했다.

재현 명령:

```sh
npm exec --yes --package=pnpm@10.17.1 -- pnpm typecheck
PATH='/tmp/pea-audio-dsp-tools.mNQ2H2/bin':"$PATH" npm exec --yes --package=pnpm@10.17.1 -- pnpm test
git diff --check
```

## 남은 검증과 한계

- 실제 Premiere UXP 적용, 청취 품질, 표준 적합성 인증, 실제 촬영 미디어 검증은 미완료.
- Noise Cleanup은 제공자 인터페이스이며 실제 denoise 미구현.
- Dialogue / Beat / Ducking은 분석·결정 API이며 렌더링/타임라인 적용은 별도.
- 앱은 캐시를 쓰기 전에 파일 fingerprint와 revision을 갱신해야 하며,
  런타임이 바뀌면 provider를 다시 생성해야 한다.
