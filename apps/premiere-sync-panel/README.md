# PEA Sync Review · 개발용 UXP 패널

이 폴더는 프리미어용 **분석·검토 패널 소스**다. 서명된 `.ccx` 설치 파일이나 단독 실행 앱이 아니다. 프로젝트 항목을 읽고 로컬 Helper에 분석을 요청하지만 시퀀스를 생성·이동·수정하지 않는다. 자막용 `apps/premiere-panel`과는 별도 패널이며, 동일 Helper 이름을 가진 PR #11을 함께 병합하지 않는다.

## 준비 조건

- Premiere Pro 25.6 이상, UXP Developer Tool 2.2 이상, Manifest v5.
- 이 브랜치의 `apps/native-helper` 및 Node.js 22, pnpm, 별도로 설치한 FFmpeg/ffprobe.
- 사용자 컴퓨터가 신뢰하는 HTTPS 인증서와 개인 키. 인증서 SAN에 IP 주소 `127.0.0.1`이 포함되어야 한다. 개인 키는 POSIX 권한 0600을 사용한다.

Adobe의 Premiere 네트워크 문서는 macOS의 HTTP 제한을 명시한다. 따라서 패널은 `https://127.0.0.1:<port>`만 허용한다. 이 코드는 인증서를 자동 발급·설치하거나 시스템 신뢰 저장소를 변경하지 않는다. TLS 검사를 끄는 옵션도 없다. 개발 테스트의 일회용 인증서는 해당 테스트 요청에만 신뢰되며 사용자 컴퓨터에 설치되지 않는다.

## Helper 실행

저장소 루트에서 실제 인증서·키 경로로 바꿔 실행한다. 아래 경로는 예시이며 파일이 제공되는 것이 아니다.

```sh
pnpm install
PEA_TLS_KEY="/absolute/private/localhost-key.pem" \
PEA_TLS_CERT="/absolute/private/localhost-cert.pem" \
pnpm --filter @pea/native-helper start
```

Helper는 `ready` JSON에 `sessionFile` 경로만 출력한다. 토큰은 출력하지 않는다. 이 JSON 파일은 해당 세션에서만 유효하다. Helper를 종료하면 세션 파일이 제거된다. 키나 세션 JSON을 저장소에 올리거나 타인에게 공유하지 않는다.

`PEA_ALLOW_HTTP=1`은 기존 로컬 개발 클라이언트 전용이다. **이 패널은 그 HTTP 세션을 거부한다.** TLS 경로를 하나만 제공하거나 잘못 제공한 경우 HTTP로 자동 전환하지 않는다.

## 패널 로드 및 사용

1. UXP Developer Tool에서 이 폴더의 `manifest.json`을 추가하고 실행 중인 Premiere에 로드한다. 개발 폴더는 `pnpm --filter @pea/premiere-sync-panel build`로 `dist`에 준비할 수 있다.
2. `세션 파일 선택`에서 Helper가 출력한 `sessionFile`을 연다. 인증된 `/v1/ping`에서 프로토콜 1과 `sync` 기능이 확인되어야 분석이 활성화된다.
3. Premiere의 **프로젝트 패널**에서 원본 클립 2~16개를 선택하고 `현재 선택 가져오기`를 누른다. 타임라인 선택을 읽는 기능이 아니다.
4. 기준 버튼을 눌러 기준 클립을 선택한 뒤 `오디오 싱크 분석`을 누른다.
5. 시간 차이·파형 유사도·검토 사유를 확인한다. JSON 저장은 검토용 보고서만 저장하며 프로젝트에는 적용하지 않는다.

기본 UI는 원본 파일 시작부터 최대 20초, 첫 오디오 스트림, 모노 8 kHz를 비교한다. 파일의 In/Out, 서브클립 구간, 프록시·배속·시퀀스 위치는 반영하지 않는다. 겹치는 소리가 이 구간에 없으면 정확한 정렬을 기대할 수 없다. 긴 촬영본 전체 탐색과 녹음기 드리프트 보정은 구현 범위 밖이다.

## 실패·취소 규칙

접수 중 취소해도 작업 번호를 받은 다음 취소 요청을 보낸다. 완료 직전의 취소는 보고서를 표시하지 않는다. 조회 중 네트워크 오류가 나면 작업 번호를 보존하고 `기존 작업 상태 재조회`만 수행하며 분석 요청을 재전송하지 않는다. 접수 응답 자체가 끊겨 번호를 모르면 중복 실행을 막기 위해 새 분석을 차단한다. 이 경우 Helper를 종료하고 새로 실행한 뒤 UDT에서 패널을 다시 로드한다.

프로젝트·클립 ID·원본 경로가 달라지면 결과 표시와 보고서 저장을 거부한다. 파일 내용이 같은 경로에서 외부 프로그램에 의해 바뀌었는지까지 패널이 계속 감시하지는 않는다. 실제 파일 기반 최종 적용 단계에서는 별도의 파일 버전 재검증이 필요하다.

## 검증 범위와 남은 확인

`pnpm test`는 패널의 Node 테스트와 기존 워크스페이스 테스트를 실행한다. 패널은 JavaScript이며 `check:syntax`는 문법 검사이지 TypeScript 타입 검사가 아니다. Helper의 TypeScript 검사는 별도로 `pnpm typecheck`가 실행한다. Helper의 필수 통합 테스트는 실제 FFmpeg와 HTTPS를 사용한다.

실제 Premiere 안에서의 UXP 로딩, 렌더링, 세션 파일 선택 권한, 임의 포트의 네트워크 허용, TLS 인증서 신뢰, 요청 Origin 헤더와 실제 선택 API 동작은 별도 수동 확인이 필요하다. Node에서 성공한 통합 테스트가 이 호스트 검증을 대신하지 않는다. Helper는 브라우저 Origin 헤더를 거부한다. 실제 UXP에서 Origin 헤더가 필요하다면 측정된 고정 Origin을 대상으로 별도 검토하며 와일드카드 CORS를 켜지 않는다.

실촬영본 정확도, 원본 변경 없는 프리미어 Apply, 설치·서명·공증은 완료로 주장하지 않는다. 이 개발 ZIP에는 인증서, 개인 키, Node 또는 FFmpeg 바이너리가 포함되지 않는다.

## 공식 문서

- https://developer.adobe.com/premiere-pro/uxp/resources/recipes/network/
- https://developer.adobe.com/premiere-pro/uxp/plugins/concepts/manifest/
- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/projectutils
- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/clipprojectitem
