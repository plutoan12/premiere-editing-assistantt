# Premiere Rough Cut 개발판

상태: 소스 구현 및 검증용 개발판. 이 문서는 서명된 설치 제품이나 실제 Premiere 재생 검수 완료를 의미하지 않습니다.

## 동작과 범위

프로젝트 패널에서 원본 클립 하나 선택 → 오디오 분석 → 무음 후보별 유지/제외 → 편집 계획 검토 → 새 러프 시퀀스 추가.

미확정 후보는 유지합니다. 원본 파일과 기존 시퀀스를 수정하지 않으며, FCP7 xmeml을 `Project.importFiles`로 추가합니다. 이 가져오기는 완전한 원자적 트랜잭션이나 일괄 실행 취소를 보장하지 않습니다. 오류가 나면 프로젝트에 일부 결과가 남을 수 있으므로 확인 없이 재시도하지 않습니다.

첫 대상은 **120초 이하, 2 GiB 이하 원본 MOV/MP4 한 개**입니다. 영상 스트림 하나, 모노/스테레오 오디오 스트림 하나, 고정 프레임률, 프로그레시브, 정사각 픽셀, 회전 없음, 영상과 오디오의 시작 시각 0을 요구합니다. 지원 프레임률은 24/25/30/50/60/120 및 24000/1001·30000/1001·60000/1001입니다.

프록시, 네스트, 멀티캠, 병합 클립, 변경한 풋티지 프레임률, 풀다운, LUT 해석 변경은 거부합니다. **원본 파일 전체를 사용하며 기존 타임라인의 효과·배속·편집·클립 In/Out을 복사하지 않습니다.** MXF, 오디오 전용 파일, 장시간 촬영본, 다중 오디오 스트림은 이번 통합 대상이 아닙니다. 원본을 바꾸는 자동 변환은 하지 않습니다.

## 구조

- `packages/rough-cut`: 기존 Core 타입을 사용하는 무음 후보·검토·프레임 정렬·SequencePlan.
- `packages/rough-media`: 디코더 인터페이스, FFmpeg 구현, HTTPS helper 및 Hybrid 클라이언트.
- `native/avfoundation`: AVFoundation 디코더, 비동기 작업·취소, CLI 검증기, Adobe SDK 바인딩 소스.
- `adapters/premiere-rough-cut`: XML, 승인 토큰, 선택·프로젝트 상태 확인, Premiere 호출 경계.
- `apps/rough-cut-panel`: 5초 단위 분석, 검토 컨트롤러, UXP 화면.
- 기존 `apps/premiere-panel`은 보존하고 빌드 단계에서 전사+러프컷 통합 패널을 별도 디렉터리에 만듭니다.

## 개발 환경과 공통 검사

전체 GitHub 저장소의 `feat/rough-cut-premiere-hybrid` 브랜치를 사용합니다. 이 변경분 ZIP만으로는 기존 Core/Sync/Transcript 의존성이 모두 포함되지 않습니다.

Node.js 22, pnpm 10.17.1, FFmpeg/ffprobe가 필요합니다. 프로젝트 루트에서:

```sh
pnpm install --no-frozen-lockfile
pnpm test
pnpm typecheck
pnpm --filter @pea/rough-cut-panel build
```

마지막 명령은 `dist/premiere-rough-helper`를 만듭니다. 이는 개발자용 플러그인 디렉터리이며 CCX가 아닙니다. `scripts/test-rough-integration-offline.mjs`는 의존성 설치 불가능 환경의 보조 실행기로, Vitest 등록만 Node test로 교체한 대상 런타임 검사입니다. 전체 저장소 타입 검사나 Premiere 검수를 대체하지 않습니다.

## macOS AVFoundation 검증

Xcode Command Line Tools와 CMake, 테스트용 FFmpeg가 설치된 Mac에서:

```sh
bash scripts/build-rough-native.sh
python3 scripts/test-avfoundation.py --binary "dist/native-$(uname -m)/pea-avfoundation"
```

이 단계는 실제 AVFoundation으로 생성한 ProRes MOV의 타임스탬프·PCM·채널·구간 길이와 네이티브 작업을 검사합니다. Adobe SDK 없이도 CLI 검증은 가능합니다. CLI 성공이 `.uxpaddon` 빌드나 Premiere 실행 성공을 의미하지는 않습니다.

## 권장: Hybrid 개발판

Premiere 26.2 이상과 **정식 Adobe UXP Hybrid SDK**가 필요합니다. Adobe Developer Console에서 받은 SDK의 `src/api/UxpAddon.h`가 있는 루트를 지정합니다. SDK 파일이나 헤더 대체품은 이 저장소에 포함하지 않습니다.

```sh
export PEA_UXP_SDK="/실제/Adobe-SDK/루트"
bash scripts/build-rough-native.sh
export PEA_UXP_ADDON="$PWD/dist/native-$(uname -m)/pea-media.uxpaddon"
node scripts/build-rough-panel.mjs hybrid
```

빌드 아키텍처를 바꾼 경우 `PEA_NATIVE_ARCH`는 arm64 또는 x86_64, 패널의 `PEA_ADDON_ARCH`는 arm64 또는 x64로 맞춥니다. 기존 빌드 디렉터리와 바이너리를 섞지 않습니다.

Premiere의 UXP 개발자 모드를 켜고 UXP Developer Tool에서 `dist/premiere-rough-hybrid/manifest.json`을 추가·로드합니다. SDK 빌드 실패나 UDT 로드 오류는 성공으로 간주하지 않습니다. 이 경로의 러프컷은 localhost 서버·STT 모델·클라우드 API 없이 동작하도록 설계되었습니다.

## 대안: 기존 HTTPS helper 경로

Premiere 25.6 이상에서 개발자용 helper 패널을 사용할 수 있습니다. **Premiere/UXP에서 신뢰하는 loopback TLS 인증서**가 필요하며 자체 서명 인증서의 자동 신뢰나 HTTP로의 자동 우회는 구현하지 않았습니다. 인증서 신뢰 설정은 실기 검증 항목입니다.

`PEA_AUDIO_ROOTS`에 실제 허용할 소스 디렉터리만 JSON 배열로 지정합니다. 파일을 실제로 읽기 전에 정규화된 경로와 허용 루트를 검사합니다.

```sh
export PEA_FFMPEG="$(command -v ffmpeg)"
export PEA_FFPROBE="$(command -v ffprobe)"
export PEA_AUDIO_ROOTS='["/실제/허용할/촬영본폴더"]'
export PEA_TLS_KEY="/실제/loopback-key.pem"
export PEA_TLS_CERT="/실제/loopback-cert.pem"
export PEA_BOOTSTRAP="$HOME/pea-bootstrap-$(date +%s).json"
# whisper/model 설정은 무음 분석에 필요하지 않습니다.
pnpm --filter @pea/native-helper exec esbuild src/cli.ts --bundle --platform=node --format=esm --target=node22 --outfile=../../dist/rough-helper.mjs
node dist/rough-helper.mjs
```

bootstrap은 새 파일로만 생성하고 0600 권한을 설정합니다. 이미 있는 파일을 덮어쓰지 않습니다. 실행한 helper를 유지한 상태에서 UDT로 helper 패널을 로드하고 `Helper 연결` 버튼에서 bootstrap을 선택합니다. 토큰과 인증서 키를 GitHub·프로젝트 파일·로그에 올리지 않습니다. `PEA_ALLOW_INSECURE_DEV=1`은 자동 테스트용이며 배포 패널은 HTTP에 연결하지 않습니다.

## Premiere 수동 합격 기준

1. 사용 권한이 있는 테스트 파일을 가져오고 프로젝트 사본을 새 이름으로 저장합니다. 프로젝트 패널에서 원본 하나만 선택합니다.
2. 분석 후 후보가 실제 무음인지 소스 모니터에서 확인합니다. 장면의 의도된 침묵은 유지합니다. 기본 기준은 -42 dBFS/500 ms, 앞뒤 여유 100 ms이며 화면에 파형·구간 재생기는 아직 없습니다.
3. 미확정 상태로 미리보기했을 때 전체 소스가 유지되는지, 한 후보를 제외하면 계획이 무효화되어 다시 검토해야 하는지 확인합니다.
4. 새 러프 시퀀스 생성 후 실제로 열고 시작·모든 컷 경계·마지막 구간을 재생합니다. 영상/음성 동기, 좌우 채널, 말끝 잘림, 원본 프레임 레이트와 색 해석을 검사합니다.
5. 기존 시퀀스와 원본 파일이 바뀌지 않았는지 확인합니다. 프로젝트를 저장하고 닫았다 다시 열어 미디어 연결과 결과를 재확인합니다. Undo/Redo는 실제 호스트 동작을 기록하며 전체 작업 원복을 미리 보장하지 않습니다.
6. 분석 중 취소, 다른 파일 선택, 프로젝트 전환, 소스 교체, 두 번 클릭, 부분 가져오기 실패를 별도 사본에서 검사합니다.
7. 실제 SDK로 빌드한 Hybrid 바이너리 서명·공증·CCX 설치·Premiere 재시작·제거를 확인한 뒤 배포 여부를 판단합니다.

## 패키징

```sh
bash scripts/package-rough-uxp.sh hybrid
# 또는 helper
```

실제 Adobe `uxp` CLI가 필요합니다. CLI 명령 차이가 있으면 UXP Developer Tool의 Package 기능에서 **빌드된 staging manifest**를 선택합니다. 일반 ZIP을 CCX로 이름만 바꾸지 않습니다. 배포용 Developer ID 서명/공증과 Adobe 호스트 로딩 검증은 별도 절차이며 이 스크립트가 자동으로 완료하지 않습니다.

## 한계와 안전 경계

파일 변경 감지는 현재 stat 기반 크기·inode·수정 시각이며 암호학적 전체 파일 해시가 아닙니다. 관련 선택/시퀀스 배치는 확인하지만 모든 이펙트·마커를 스냅샷으로 만들지는 않습니다. 네이티브 디코더는 매 윈도마다 소스 전체 검증을 재실행하므로 긴 파일 처리 효율은 후속 과제입니다. 서버에서 제출은 됐지만 클라이언트가 작업 ID 응답을 잃은 경우 작업 정리를 위해 helper 재시작이 필요할 수 있습니다. 분석 모델이나 AI의 창작 판단을 자동 적용하지 않습니다.

## 공식 API 근거

- Adobe Hybrid: https://developer.adobe.com/uxp/guides/how-to/hybrid-plugins/
- Premiere Project: https://developer.adobe.com/premiere-pro/uxp/ppro_reference/classes/project/
- Premiere ClipProjectItem: https://developer.adobe.com/premiere-pro/uxp/ppro_reference/classes/clipprojectitem/
- Apple AVAssetReaderTrackOutput: https://developer.apple.com/documentation/avfoundation/avassetreadertrackoutput
