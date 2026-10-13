# PEA Sync Local 0.2.0 — 개발용 패널

## 현재 상태

Premiere UXP manifest, `require("premierepro")` 부팅, Sync Controller, 별도 파일 작업 Helper, Dry Run/Apply/네이티브 타임라인 위치 재확인 코드가 포함된 개발용 빌드다. 독립 실행 편집기나 서명된 설치 프로그램이 아니다.

자동 검증은 실제 FFmpeg와 생성된 WAV/MOV 파일, Node 기반 UXP 파일 인터페이스와 Premiere API 모형을 사용한다. **사용자의 Mac/Premiere 실앱, 실제 촬영본, 설치·재실행·언인스톨 검증은 아직 완료하지 않았다.** 자동 테스트 통과를 이 항목의 성공으로 해석하면 안 된다.

## 실행 조건

- Premiere 25.6 이상과 UXP Developer Tool 2.2 이상. Premiere의 개발자 모드가 필요하다.
- 로컬 Node.js 22 이상, FFmpeg 및 ffprobe. 실행 파일을 자동 다운로드하거나 인증서/운영체제 보안 설정을 바꾸지 않는다.
- 반드시 다른 이름으로 저장한 테스트 프로젝트 복사본.
- 출력 설정을 가져올 기존 기준 시퀀스 하나를 활성화한다. 새 Sync 시퀀스는 그 설정을 복사한다.

## 빌드된 ZIP 실행

1. ZIP 전체를 같은 폴더에 푼다. `pea-sync-panel/manifest.json`, `pea-sync-helper/cli.cjs`, `start-helper.command`가 있어야 한다.
2. `start-helper.command`를 실행한다. 터미널에서 `bash /압축을푼폴더/start-helper.command`로 실행할 수도 있다. 실행 중인 터미널은 유지한다.
3. Helper가 출력하는 `PEA Sync Sessions/session-...` 폴더 경로를 확인한다. 이 폴더에는 세션 토큰이 있으므로 공유하거나 GitHub에 올리지 않는다.
4. UXP Developer Tool에서 **Add Plugin → pea-sync-panel/manifest.json → Load**. Premiere에서 PEA Sync 패널을 연다.
5. 패널의 **Helper 세션 폴더 연결**로 3번 폴더를 선택한다. 폴더 선택창에서 Cmd+Shift+G로 출력된 경로를 입력할 수 있다.
6. 기준 시퀀스를 열고 프로젝트 패널에서 원본 클립 2~16개를 선택한 뒤 **Premiere 선택 클립 읽기**를 누른다. 기준 음원을 선택한다.
7. 공통 소리가 들어 있는 구간을 지정하고 분석한다. 기본값은 시작 0초, 길이 8초, 분석용 8 kHz 모노다. 입력 영상·오디오 파일은 변경하지 않는다.
8. 매칭과 검수 필요 항목을 확인하고 새 이름으로 **Dry Run**한다. 클립 위치와 프레임 반올림 오차를 확인한다.
9. 테스트 프로젝트 복사본 확인 체크박스를 선택하고 **Apply**한다. 새 Sync 시퀀스만 생성하며, 기존 편집 시퀀스를 덮어쓰지 않는다.
10. 적용 후 패널의 위치 재검증 결과뿐 아니라 실제 재생·파형·슬레이트를 직접 확인한다. **검증 결과 저장**으로 네이티브 읽기 결과를 JSON에 저장할 수 있다.

Helper는 Ctrl+C로 종료한다. 종료하면 이번 실행이 생성한 세션 폴더만 제거한다. 사용자 영상·프로젝트는 삭제하지 않는다. 강제 종료로 남은 세션 폴더는 실행 중인 Helper가 없는지 확인한 뒤 해당 세션 폴더만 정리한다. 다음 실행에서는 새 폴더를 다시 선택한다.

## Mac 통신 방식

Adobe의 현재 Premiere 네트워크 문서는 macOS에서 일반 HTTP URL을 제한한다고 명시한다. 이 패널은 `127.0.0.1` HTTP가 동작한다고 가정하지 않고, 사용자가 선택한 private 세션 폴더로 작은 버전 지정 JSON 작업만 교환한다. `localFileSystem: request` 외에 전체 파일 접근, 네트워크, 프로세스 실행 권한을 요청하지 않는다. 기존 HTTP 클라이언트는 다른 호출자를 위해 저장소에 유지한다.

Helper는 랜덤 세션 토큰·버전 검사, 완료 마커, 제한된 작업 크기, 단일 작업 실행, 취소 마커를 사용한다. 파형 계산과 FFmpeg는 Helper에서 실행하므로 UXP UI 스레드에서 긴 FFT를 돌리지 않는다. PCM 임시 파일은 작업 종료 시 제거한다. 소스 변경 검사는 크기·수정 시각·파일 식별자를 사용하는 **stat-v1**이며 전체 원본 파일의 암호학적 해시 검증은 아니다. PCM 해시는 분석한 디코딩 구간에만 해당한다.

## 범위와 제한

- 패널 모드는 오디오·플레이백이다. 카메라 clock/day 정보를 안전하게 가져오는 UI가 없으므로 타임코드 모드를 성공한 것처럼 노출하지 않는다.
- 0이 아닌 Source In, 중첩/병합/멀티캠 프로젝트 아이템, 오프라인 미디어는 거부한다. 일반 원본 클립부터 검증한다.
- 동일한 시작 구간의 공통 파형을 비교한다. 전체 장시간 녹화 탐색, 드리프트 보정, 음소별 자막·더빙 싱크는 포함하지 않는다.
- 신뢰도 숫자는 유사도이지 정확도 확률이 아니다. 검수 결과에는 배치 좌표를 강제로 부여하지 않는다.
- 시퀀스 배치는 기준 시퀀스의 프레임 격자에 반올림한다. 영상 배치를 오디오 샘플 단위 정확도로 광고하지 않는다.
- 클립별 전용 트랙을 사용한다. 복잡한 멀티채널 오디오 매핑은 실제 호스트에서 별도 검증해야 한다. 예상치 못한 클립이나 위치가 발견되면 읽기 검증이 실패로 표시된다.
- Apply는 한번만 소비되는 private 계획을 사용하고, 직전 Helper 상태·소스 버전·Premiere 상태를 재검사한다. 일부 적용 실패는 자동 롤백을 의미하지 않는다. 생성된 빈/부분 Sync 시퀀스가 남을 수 있다.

## 저장소에서 빌드/검증

```sh
pnpm install --no-frozen-lockfile
pnpm test
pnpm typecheck
pnpm --filter @pea/premiere-panel build
PEA_FFMPEG_INTEGRATION=1 pnpm --filter @pea/premiere-panel test
```

`dist/pea-sync-panel`을 UDT로 불러온다. `dist/start-helper.command`는 같은 `dist/pea-sync-helper`를 실행한다. 빌더는 저장소의 TypeScript 개발 의존성으로 정적 CommonJS 번들을 만들며, 패널의 유일한 외부 require는 `premierepro`, `uxp`다. `eval`, 동적 코드 다운로드 또는 Node 모듈 shim을 패널에 넣지 않는다.

## 공식 참고

- https://developer.adobe.com/premiere-pro/uxp/plugins/concepts/manifest/
- https://developer.adobe.com/premiere-pro/uxp/plugins/concepts/entrypoints/
- https://developer.adobe.com/premiere-pro/uxp/resources/recipes/network/
- https://developer.adobe.com/premiere-pro/uxp/resources/recipes/filesystem-operations/
- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project
- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequenceeditor
