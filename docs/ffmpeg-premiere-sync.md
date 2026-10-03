# 파일 기반 싱크와 Premiere 가져오기

## 구현 상태

`feat/ffmpeg-premiere-sync`는 싱크 엔진 PR #2 위에 쌓는 후속 작업이다. 원본 파일을 수정하지 않고 로컬 FFmpeg 분석 → 검수 보고서 → FCP7 XML → 사용자 승인 후 Premiere 가져오기를 연결한다.

**실제 촬영본 검수와 Premiere 호스트 실행은 아직 완료되지 않았다.** 자동 테스트의 MOV·MP4·WAV는 생성한 합성 미디어다. UXP 패널 테스트는 호스트 대역을 사용한다. 이 둘을 실제 카메라 촬영본이나 Premiere 실행 검증으로 해석하면 안 된다.

## 구성

- `packages/media-ffmpeg`: 제한된 프로세스 실행, ffprobe 메타데이터, 선택한 오디오 스트림·채널의 샘플 창 추출.
- `adapters/premiere`: 검수 가능한 새 시퀀스 계획과 FCP7 xmeml 출력. 기존 프로젝트를 직접 고치지 않는다.
- `apps/sync-cli`: JSON 파일 목록을 받아 분석 보고서와 XML을 저장한다.
- `apps/premiere-sync-panel`: UXP Developer Tool로 로드하는 개발용 가져오기 패널. 서명된 배포용 설치 파일이 아니다.

## 준비

Node.js 22, pnpm 10.17.1, PATH에서 실행되는 `ffmpeg`와 `ffprobe`가 필요하다. 저장소의 후속 브랜치에서 `pnpm install`을 실행한다. Premiere 패널은 Premiere 25.6 이상을 대상으로 작성했다. 실제 설치·가져오기 호환성은 호스트 검수로 확정해야 한다.

## 생성 미디어로 처음부터 끝까지 실행

저장소 루트에서 다음을 실행한다. 두 출력 폴더는 기존에 없어야 한다.

```sh
pnpm sync:demo /tmp/pea-sync-demo
pnpm sync:files /tmp/pea-sync-demo/job.json /tmp/pea-sync-demo/output
python3 scripts/validate-sync-xml.py /tmp/pea-sync-demo/output/sync.xml --demo
```

생성되는 카메라 A는 기준 녹음과 같은 위치, 카메라 B는 1.375초 뒤의 소리를 담는다. 기대 배치는 24fps에서 A=0, B=33프레임이다. XML 검사는 문법·참조·트랙 범위의 독립 구조 검사이며 Premiere 실행 검사는 아니다.

## 실제 촬영본 파일 목록

아래 파일 경로는 예시다. 본인 파일 경로로 바꿔 `job.json`으로 저장한다. 상대 경로는 실행 위치가 아니라 JSON 파일이 있는 폴더를 기준으로 해석한다.

```json
{
  "schemaVersion": "1.0.0",
  "name": "Scene 01 sync review",
  "referenceClipId": "recorder",
  "files": [
    {"clipId": "recorder", "path": "audio/scene01.wav"},
    {"clipId": "camera-a", "path": "video/A001.mov", "audioStream": 0, "channel": 0},
    {"clipId": "camera-b", "path": "video/B001.mov", "audioStream": 0, "channel": 0}
  ],
  "analysis": {"sampleRate": 8000, "windowSeconds": 20},
  "sequence": {
    "frameRate": {"rate": {"numerator": 24, "denominator": 1}, "dropFrame": false},
    "width": 1920,
    "height": 1080,
    "rounding": "reject"
  }
}
```

```sh
pnpm sync:files /Volumes/SHOOT/job.json /Volumes/SHOOT/sync-review-01
```

CLI 종료 코드는 0=XML 검수 준비, 2=싱크/내보내기 검수 필요, 1=실행 오류, 130=취소다. 0은 사람이 확인한 최종 싱크 정확도나 Premiere 가져오기 성공을 의미하지 않는다.

### 분석 범위와 시간

기본은 각 파일 앞 20초를 8kHz, 오디오 스트림 0의 채널 0으로 분석한다. 필요한 경우 파일별 `windowStartSeconds`를 지정한다. 모든 파일의 선택 구간에 공통 소리가 있어야 한다. 파일 전체를 자동 탐색했다고 가정하지 않는다.

한 창은 최대 262,144샘플이다. 채널을 명시적으로 선택하므로 위상이 반대인 스테레오를 단순 합산해 무음으로 만들지 않는다. 영상보다 늦게 시작하는 오디오 스트림의 초기 시간차도 유지한다. 속도 변경이나 드리프트 보정은 하지 않는다.

정확한 샘플 시작점을 위해 파일 처음부터 디코딩한다. 긴 파일 후반부 분석에는 비효율적일 수 있으며 프로세스 기본 제한 시간은 60초다. 긴 파일 구간 스케줄러와 빠른 탐색은 후속 범위다.

이 CLI는 자동 타임코드 클록 추정을 하지 않는다. 기존 싱크 엔진의 타임코드 기능은 공통 클록 정보가 명시된 API 입력에서 계속 사용할 수 있다.

## 결과 해석

- `sync-report.json`: 원본 메타데이터, FFmpeg/ffprobe 버전, 분석 창, 후보별 이유, 오프셋, Premiere 계획과 제한 사항. bigint 시간 값은 JSON 문자열로 저장한다.
- `sync.xml`: 모든 클립이 매칭되고 시퀀스 변환이 가능한 경우에만 생성한다.

반복음·무음·불충분한 겹침 등으로 검수 상태가 나온 클립에 임의의 시간차를 붙이지 않는다. 부분 성공만으로 XML을 만들지 않는다. 기존 결과 폴더나 파일은 덮어쓰지 않는다.

양수 오프셋은 기준 클립보다 늦게 배치한다는 뜻이다. 음수 오프셋이 있으면 모든 클립을 함께 이동시켜 시퀀스 시작점이 음수가 되지 않게 한다.

## Premiere에 가져오기

### 일반 가져오기

새 프로젝트 또는 작업용 복사본에서 `File > Import`로 `sync.xml`을 가져온다. 파일을 다른 컴퓨터로 옮겼다면 원본 미디어를 다시 연결해야 한다.

### 개발용 UXP 패널

UXP Developer Tool에서 `apps/premiere-sync-panel/manifest.json`을 추가하고 로드한다. 패널에서 XML 선택 → 현재 프로젝트 확인 → 승인 체크 → 가져오기를 실행한다.

패널은 공개 `Project.getActiveProject`, `getRootItem`, `importFiles`, `getSequences` API를 사용한다. 미리보기 뒤 XML이 바뀌면 중단하고, 중복 클릭을 막는다. 가져오기 실패 시 부분적인 프로젝트 변경이 남을 수 있으므로 자동 재시도하지 않는다. 프로젝트를 자동 저장하거나 기존 시퀀스를 삭제하지 않는다.

**출력은 정렬된 일반 시퀀스다. Premiere의 네이티브 멀티캠 소스 시퀀스 생성까지 구현한 것은 아니다.**

원본 오디오 채널은 모두 유지하되 기준 소스의 오디오만 기본 모니터링 대상으로 켠다. 다른 카메라 오디오는 트랙 비활성으로 출력해 여러 현장음이 합산되지 않게 한다. 가져오기 후 해당 트랙 상태가 유지되는지도 확인해야 한다. 시퀀스 오디오 포맷은 48kHz이며 원본 파일은 재인코딩하지 않는다.

## 프레임 안전장치

엔진은 샘플 단위 시간차를 유지하지만 이 XML 경로는 프레임 단위 배치다. `rounding: "reject"`가 기본이며 프레임 사이에 걸친 배치는 막는다. `"nearest"`를 명시하면 가장 가까운 프레임으로 배치하고 오차를 보고서에 남긴다. 원본 끝의 프레임 미만 길이도 명시적으로 제외하고 경고한다.

영상과 시퀀스의 프레임레이트가 다르거나 VFR이 의심되면 자동 변환하지 않고 내보내기를 막는다. 평균/명목 프레임레이트 일치가 파일 전체의 CFR을 증명하지는 않는다. 비표준 비디오 시작점, 24시간 이상 시퀀스, 32채널 초과 오디오는 이 버전 범위 밖이다.

## 검증과 남은 게이트

로컬에서는 Node 테스트 등록 방식으로 기존 엔진과 신규 TypeScript 테스트 75개, 네이티브 패널 경계 테스트 7개를 실행했다. 네트워크 의존성 설치가 불가해 로컬에서는 TypeScript를 transpile한 뒤 Vitest의 테스트 등록만 `node:test`로 대체했다. 이 실행을 타입 검사로 간주하지 않는다. 정식 Vitest·타입 검사는 GitHub CI에서 따로 확인한다.

추가 검증: PCM WAV/MOV, AAC MP4, 44.1kHz→8kHz 분석, 양/음 오프셋, 초기 PTS 지연, 채널 선택, 소스 해시 불변, 취소·타임아웃·출력 제한, 잘못된 시퀀스 설정, XML 독립 구조 검사.

코드 최종 검토는 작성자 자체 검토다. 독립 리뷰어 검토는 하지 않았다. 실제 촬영본에서 시작·중간·끝 파형과 입 모양을 확인하고, Premiere에서 미디어 링크·채널·배치·반올림 오차·트랙 활성 상태를 확인하기 전까지 현장 사용 승인 상태로 올리지 않는다.

## 참고한 공식 문서

- FFmpeg CLI: https://www.ffmpeg.org/ffmpeg.html
- FFmpeg 필터: https://ffmpeg.org/ffmpeg-filters.html
- Adobe FCP7 XML 가져오기: https://helpx.adobe.com/ee/premiere-pro/how-to/migrate-from-final-cut-pro.html
- Adobe UXP Project API: https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project/
- Adobe UXP manifest: https://developer.adobe.com/premiere-pro/uxp/plugins/concepts/manifest/
- Apple FCP7 XML 규격: https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/FinalCutPro_XML/Elements/Elements.html
