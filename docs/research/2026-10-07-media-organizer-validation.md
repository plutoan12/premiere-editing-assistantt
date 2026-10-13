# Media Organizer 공통 엔진 검증 기록

최초 검증: 2026-10-07, PR 검토 반영: 2026-10-09 (Asia/Seoul). 범위: 승인된 첫 엔진 구현 계획의 Task 1–8 및 PR #17 검토 지적 수정.

## 구현과 재사용

- 기반: `131f0505199349f4807953f78d8512f81bc7e1db` (`feat/core-contracts`의 Sync 통합 상태). 기존 Core 계약은 계획 시점과 동일했다.
- 기존 `@pea/core`의 미디어·클립·시간·Job·Artifact·provider 계약을 사용했다. 정확한 시간 JSON codec과 `media` 문서 종류를 추가했다.
- `@pea/media-organizer`에 카탈로그, 스캔·등록, 사용자 수정·분류, MiniSearch 검색, 적용 계획·결과 계약, JSON 교환, 경로 재연결을 구현했다.
- MiniSearch `7.2.0`은 공개 API로 사용하며 MIT 고지를 `THIRD_PARTY_NOTICES.md`에 보존했다.
- 실제 Premiere/SQLite/미디어 decoder·썸네일은 구현하지 않았다. 가상 editor는 테스트용이다.

## 실행 검증

- `npx --yes pnpm@10.17.1 test`: Core 26, Sync 51, Media 76개 테스트 통과 (총 153개, 2026-10-09 PR 검토 반영 후).
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

## 최종 독립 코드 검토와 수정

별도 문맥의 gpt-6-astra 검토자가 `131f050..7f605b3` 전체 변경을 읽고 공개 API로 문제를 재현했다. Critical 0건, Important 5건, Minor 0건. 다섯 항목 모두 중요도로 수용해 한 차례 수정했다. 각 항목의 회귀 테스트가 수정 전 실패하는 것을 확인했고, 수정 후 전체 146개 테스트와 타입 검사를 통과했다. 수정 후 별도 재검토는 진행하지 않았다.

| 지적 | 수정과 회귀 검증 |
|---|---|
| 동일 작업의 중복 URI가 변경된 파일에 이전 분석을 재사용 | 검증한 파일 상태·분석 이력을 함께 비교한다. 변경 시 같은 asset을 재분석한다. `reanalyses a duplicate request when its source stamp changed` 실패→통과. |
| 변경 후 분석 실패에도 기존 구간을 적용 가능 | `sourceState: unverified`로 asset·clip 적용 및 이전 캐시 재사용을 막고 마지막 정상 분석과 사용자 데이터를 보존한다. 내용 변경·불안정 읽기는 구간을 재확인 대상으로 표시한다. `blocks changed sources after failed probing while preserving user data`, `does not reuse a historical scan after an unstable failed read` 실패→통과. |
| 과거 스캔과 현재 분석 결과의 연결 부재 | `verifiedAnalysis`에 fileRevision·artifactId를 기록하고 현재 provider/settings와 함께 검사한다. provider, settings, 분석 세대, 파일 revision 회귀 4개 실패→통과. 기존 linkage 없는 스캔은 재분석한다. |
| 돌아온 파일이 계속 오프라인 | 유효한 캐시 재사용 때 availability를 online으로 갱신한다. `restores availability when a verified unchanged source returns` 실패→통과. |
| 시간대 없는 자동 촬영일이 확인 없이 사용됨 | probe/host 관측값을 보존하면서 `needs_review`로 표시한다. 명시적 사용자 수정 전 날짜 분류 적용을 차단하며 unknown 허용으로 우회하지 못한다. probe/host 회귀 2개 실패→통과. |

동일 파일 중복 입력의 정상 캐시 재사용과 명시적 timezone·파일명 날짜 규칙의 정상 동작도 확인했다. 수정 전 집중 테스트는 10개 실패·22개 통과였고, 수정 후 모두 통과했다. 브라우저 bundle 검사도 전체 suite에 포함됐다. 검색 로직은 이 수정에서 변경하지 않았으므로 위 benchmark를 유지한다.

## 검토자가 판단을 보류한 항목에 대한 결정

4. 실제 Premiere ID·변경·Undo·crash 복구는 후속 호스트 통합 범위로 유지한다. 잘못됐을 때 비용: 실제 편집기 결함이 통합 시험까지 드러나지 않을 수 있다.
5. SQLite·migration·실제 decoder/hash 검증은 후속 구현으로 유지한다. 현재는 메모리 저장소와 주입된 provider 계약이다. 비용: 영구 저장과 실제 미디어 분석 결함은 아직 검증되지 않았다.
6. 카메라 모델명을 deviceId로 잘못 전달하는 것은 provider 정규화 책임이다. 문자열만으로 물리 기기를 추론하지 않는다. 비용: 잘못된 provider가 여러 카메라를 하나로 분류할 수 있다.
7. 파일 상태의 모든 요소를 유지한 동시 변경에 대한 잠금 보장은 제공하지 않는다. 비용: 그런 원본 변경은 탐지하지 못할 수 있다.
8. 취소 후 남은 입력에는 파일 분석 없이 취소 결과를 기록한다. 비용: 대기 항목 수에 따라 취소 기록 시간이 증가한다.
9. 불투명한 어댑터 명령의 의미 검증·실행 허가는 어댑터 책임으로 유지한다. 가져오기는 데이터 검증만 수행한다. 비용: 잘못된 어댑터가 부적합한 명령을 실행할 수 있다.
10. 기존 asset 재분석은 기존 clip ID를 유지한다. 별도 clip 생성은 별도 동작이다. 비용: 새 clip 생성을 기대하는 호출자는 추가 동작이 필요하다.
11. 추가적인 잘못된 문서 참조 조합은 재현된 결함이 없어 현재 검증을 유지한다. 모든 악의적 입력을 검증했다고 주장하지 않는다. 비용: 시험하지 않은 잘못된 snapshot이 허용될 수 있다.

미뤄 둔 Minor 지적은 없다. 위 결정 1–11은 실행 기록의 모든 `Ruling:` 항목을 보존한다.

## 2026-10-09 PR #17 검토 반영

사용자가 전달한 추가 지적 3건을 반영했다. 기존 PR 자동 리뷰의 동일 지적을 공개 API로 재현했으며, 각 수정 전에 해당 회귀 테스트의 실패를 확인했다.

| 지적 | 처리와 검증 |
|---|---|
| 한 복사본의 내용 교체가 다른 경로의 지문까지 바꿈 | 내용 변경 시 검증된 입력 경로만 `locations`에 남기고 대표 URI도 그 경로로 설정한다. asset/clip ID와 사용자 수정은 보존한다. 대표 경로 교체·복사 경로 교체 2개 테스트 실패→통과. 이전 경로 재스캔이 지문을 뒤집지 못하고 별도 등록할 수 있음을 확인했다. 동일 내용 재분석은 기존 복수 경로를 보존한다. |
| 구간·미확인 태그가 전체 항목 태그가 됨 | `confirmed`이고 `range`가 없는 태그만 적용안의 전체 항목 태그로 복사한다. 나머지 주석은 카탈로그에 그대로 보존한다. asset·clip 대상 2개 테스트 실패→통과. |
| 변경된 파일도 `unchanged`로 보고 | 내용 교체는 `updated`로 보고하고 scan·Job·JSON에도 보존한다. 현재 분석과 연결된 `updated` 결과는 재사용할 수 있고, 재사용 결과는 `unchanged`다. 변경 결과의 저장·JSON 왕복·재개, 한 작업의 중복 입력 처리 2개 테스트 실패→통과. |

전체 153개 테스트, workspace 타입 검사, 브라우저 bundle 검사 및 변경 공백 검사를 통과했다. 새 테스트 7개 중 회귀 6개는 수정 전 실패했고, 동일 내용 복사본을 보존하는 정상 동작 1개도 검증했다. 검색 구현은 변경하지 않았다. 실제 Premiere·영구 저장소 검증 범위는 그대로 후속이다.
