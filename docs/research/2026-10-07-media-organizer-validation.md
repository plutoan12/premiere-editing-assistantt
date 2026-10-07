# Media Organizer 공통 엔진 검증 기록

날짜: 2026-10-07 (Asia/Seoul). 범위: 승인된 첫 엔진 구현 계획의 Task 1–8.

## 구현과 재사용

- 기반: `131f0505199349f4807953f78d8512f81bc7e1db` (`feat/core-contracts`의 Sync 통합 상태). 기존 Core 계약은 계획 시점과 동일했다.
- 기존 `@pea/core`의 미디어·클립·시간·Job·Artifact·provider 계약을 사용했다. 정확한 시간 JSON codec과 `media` 문서 종류를 추가했다.
- `@pea/media-organizer`에 카탈로그, 스캔·등록, 사용자 수정·분류, MiniSearch 검색, 적용 계획·결과 계약, JSON 교환, 경로 재연결을 구현했다.
- MiniSearch `7.2.0`은 공개 API로 사용하며 MIT 고지를 `THIRD_PARTY_NOTICES.md`에 보존했다.
- 실제 Premiere/SQLite/미디어 decoder·썸네일은 구현하지 않았다. 가상 editor는 테스트용이다.

## 실행 검증

- `npx --yes pnpm@10.17.1 test`: Core 26, Sync 51, Media 57개 테스트 통과 (총 134개, 최종 검토 수정 전).
- `npx --yes pnpm@10.17.1 typecheck`: 전체 workspace 통과.
- esbuild로 browser / ES2022 / ESM bundle을 만들고 host·Node·native DB/decoder 의존성이 들어오지 않는지 확인했다. 이 결과는 UXP 실제 실행 보장이 아니다.
- 전체 흐름: 두 카메라·같은 파일명·오프라인 입력 → 등록 → 사용자 카메라/날짜/태그 → 분류 → 검색 → 검토안 저장 → JSON 왕복 → 테스트 host의 결과 재확인.
- 실패 검증: 불완전한 hash, 파일 읽기 도중 변경, 취소, 저장 실패, 재분석 실패 후 ID 보존, 이동 전 경로의 재스캔, 기간·참조·버전 오류, 오래된 프로젝트/기능/항목 상태, 적용 전 내보내기 상태.
- 새 기능은 실패 테스트를 먼저 실행했다. 통합·공개 API·bundle 검사는 기존 구현을 결합한 뒤 통과했다. 테스트 fixture 타입과 wire schema의 입력/출력 타입 차이에서 발생한 타입 검사 오류도 수정 후 재검증했다.

## 500개 합성 자료의 검색 측정

인덱싱 완료 후 한글 파일명·카메라·태그 질의. 20회 warm-up, 200회 계측. p95 설계 목표는 300ms이다. 실제 코덱 분석·파일 I/O·Premiere UI 시간은 포함하지 않는다.

```json
{"items":500,"warmup":20,"samples":200,"p50Ms":0.30429199999997536,"p95Ms":0.42379099999999426,"p99Ms":0.5917079999999828,"node":"v24.18.1","platform":"darwin","arch":"arm64","cpu":"Apple M3 Max"}
```

## 구현 중 판단

1. 기준 커밋을 최신 통합 Core/Sync `131f050`으로 올렸다. Core 계약은 동일하며 기존 Sync 개선을 보존하기 위해서다. 잘못됐을 때의 위험은 통합 회귀이며 전체 suite로 확인했다.
2. `clipStates`에 fileRevision과 reviewState를 추가했다. 파일 내용이 바뀌어도 사용자 구간을 지우지 않고 재확인 대상으로 보존한다. 후속 어댑터가 이 상태를 무시하면 오래된 범위를 사용할 위험이 있어 적용 계획에서 차단한다.
3. `IngestContext.retryJobId`를 추가했다. 계획의 failed Job 재시도 요구에 입력이 빠져 있었기 때문이다. 추후 계약이 바뀌면 이 선택적 필드의 호환 처리가 필요하다.

## 다음 제품 단계

UXP 번들 실제 로딩, 파일 부분 읽기/해시, 미디어 provider 선택, SQLite 영구 저장·백업·migration·crash 복구, Premiere 항목 ID/Undo/원본 무변경, 패널 UI·썸네일·배포를 검증해야 한다. 이 문서의 성공 결과를 전체 v0.1 출시 준비로 해석하지 않는다.

최종 독립 코드 검토와 수정 결과는 아래에 추가한다.
