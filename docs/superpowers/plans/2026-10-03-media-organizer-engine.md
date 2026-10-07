# Media Organizer Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 `@pea/core`를 사용해 미디어 등록, 사용자 수정 보존, 자동 분류, 검색, 편집기별 적용 계획 검증을 수행하는 독립 TypeScript 패키지를 만든다.

**Architecture:** `packages/media-organizer`는 Core 계약과 주입된 파일·분석·저장 인터페이스만 사용한다. 첫 구현은 실제 검색 라이브러리와 메모리 저장소로 전체 엔진 흐름을 검증하고, 이후 SQLite·Premiere 구현이 같은 계약을 사용한다. Adobe 객체는 엔진에 전달하지 않는다.

**Tech Stack:** 저장소의 pnpm 10.17.1, TypeScript 5.9 계열, Zod 4 계열, Vitest 3 계열, `@pea/core`; 검색은 MiniSearch 7.2.0 공개 API를 우선 채택한다.

**Spec:** [Media Organizer 설계](../specs/2026-10-03-media-organizer-design.md), [실제 GitHub 코드 검색 기록](../../research/2026-10-03-media-organizer-code-reuse.md).

## Global Constraints

- **계획 상태:** 2026-10-07 사용자가 직접 구현을 선택했다. Task 1–8의 공통 엔진 구현·자동 검증을 마쳤으며 최종 독립 코드 검토를 진행한다. UXP·SQLite·실제 호스트 테스트는 후속 범위다.
- **기준 코드:** `origin/feat/core-contracts`의 `9f2119ce55bd090c86e84b058725776a9405228c`. 2026-10-03 재조회 시 변경 없음. `main`에 병합됐다고 가정하지 않는다.
- 실행 시 관리되는 별도 작업 트리에서 시작한다. 현재 `codex/premiere-sync` 작업 트리는 유지한다. Core 변경은 별도 커밋으로 분리하고 기반 브랜치의 후속 변경과 중복되지 않는지 확인한다.
- 기존 Core의 `MediaAsset`, `ClipReference`, `MediaTime`, `Job`, `Artifact`, `Provenance`, `MediaProbeProvider`를 재사용한다. 다른 Core나 Sync 알고리즘을 만들지 않는다.
- `MediaTime {ticks: bigint, timebase: {numerator, denominator}}`, `TimeRange {start, duration}`, `readOnly: true`를 유지한다. 부동소수 초로 중간 변환하지 않는다.
- SHA-256 완성 전 항목은 임시 스캔 상태다. 부분 해시·파일명을 Core fingerprint로 쓰지 않는다. 서로 다른 경로의 같은 내용도 자동 병합하지 않는다.
- 영구 ID는 UUID다. 파일 경로·이름·내용 해시·호스트 ID는 영구 ID를 대신하지 않는다. 기존 Core가 허용하는 레거시 ID 형식은 Core 차원에서 일괄 강화하지 않는다.
- 사용자 수정, 메모, 태그, 즐겨찾기는 재분석으로 사라지지 않는다. 원본 이동·이름 변경·삭제·메타데이터 쓰기·클라우드 전송을 위한 엔진 API는 제공하지 않는다.
- Job 상태는 `queued / running / completed / failed / cancelled`다. 항목별 부분 실패는 결과에 기록하고 Job 상태를 추가하지 않는다.
- 첫 제품의 영구 저장소는 SQLite다. 이 계획의 메모리 구현은 계약 검증용이며 제품 저장·재시작 내구성 검증을 대신하지 않는다.
- 첫 제품의 실제 어댑터는 Premiere다. 이 계획의 테스트 어댑터 통과를 Final Cut Pro·Resolve 지원으로 표시하지 않는다.
- AI 검색·전사 생성·Marker 쓰기·썸네일 생성·Premiere UI·실제 호스트 변경은 후속 구현 단계다. 아래 범위표에서 빠짐없이 연결한다.

## Review Focus

1. 같은 이름·같은 바이트·다른 호스트에서 같은 항목 ID: 사용자 의도 없이 합쳐지지 않아야 한다. Task 2·3·6.
2. 해시/분석 도중 파일 변경, 취소, 저장 실패: 불완전한 결과가 유효 결과로 승격되지 않아야 한다. Task 3.
3. 시간대 없는 촬영일, 같은 모델의 다른 카메라, 서로 다른 자동 후보: 추측하지 않고 미확인·충돌로 남겨야 한다. Task 4.
4. 한글 NFC/NFD 파일명과 사용자 태그 수정: 검색 결과는 갱신되되 파일 접근 경로는 바뀌지 않아야 한다. Task 5·7.
5. 검토 후 프로젝트 변경·Undo, 내보내기만 끝난 결과, 실행 기록 유실: 실제 적용으로 오인하거나 중복 실행하지 않아야 한다. Task 6·8 및 후속 호스트 검증.

---

## 이번 구현의 범위와 후속 연결

| 단계 | 독립적으로 확인할 결과 | 이 문서의 범위 |
|---|---|---|
| **1. 공통 엔진** | 테스트 입력 등록 → 수정 → 분류 → 검색 → 적용안 → 결과 검증, JSON 왕복 | Task 1–8의 실행 가능한 계획 |
| **2. 실제 런타임 검증** | UXP 번들·파일 부분 읽기·WASM 또는 native 분석·SQLite·안정적 호스트 ID 실측 | 아래 검증표. 결과에 따라 provider·배포 구성을 확정 |
| **3. Premiere 제품 연결** | SQLite 카탈로그, 썸네일, 네 개 탭, 실제 Bin 반영·재시작·재시도 | 2단계 결과로 별도 구현 계획 작성 |
| **4. 출시 검증** | 500개 기준 자료, 원본 무변경, 프로젝트 재개방·Undo·실패 복구, 실제 검색 시간 | 설계 13절의 완료 기준 적용 |

1단계만 끝난 상태를 v0.1 제품 완성이라고 부르지 않는다. 순수 엔진의 테스트 결과와 Premiere/OS의 실행 결과를 각각 기록한다.

**검색 선택:** MiniSearch를 우선 구현한다. 이미 읽은 `addAllAsync`, `replace`, `search`를 사용해 TypeScript 엔진에서 검색을 확인할 수 있고 별도 검색 알고리즘을 만들 필요가 없다. SQLite는 기준 데이터를 저장하며 초기에는 FTS5 색인을 함께 탑재하지 않는다. UXP 번들 또는 실제 검색 자료에서 채택 조건을 충족하지 못하면 `SearchIndex` 구현을 FTS5로 교체하고 같은 정답 자료로 검증한다. 한국어 형태소·의미 검색은 약속하지 않는다.

**미디어 분석 선택:** 실제 분석기는 2단계에서 결정한다. 우선 검증 대상은 `mediainfo.js`의 `analyzeData(size, readChunk)`이며 파일 부분 읽기·WASM·메모리 사용이 통과해야 한다. 실패하면 동일 `MediaProbeProvider` 뒤에서 MediaInfoLib/native 또는 ffprobe를 검증한다. 1단계의 고정 결과 provider를 실제 코덱 지원 증거로 사용하지 않는다.

## 파일 배치와 소유권

| 위치 | 책임 |
|---|---|
| `packages/core/src/time-json.ts`, `media-document.ts` | 공통 시간 JSON 변환, 미디어 교환 문서 |
| `packages/core/src/time.ts`, `validation.ts`, `index.ts` | 정확한 시간 연산·경계 검증, 기존 파싱 진입점의 추가 지원 |
| `packages/media-organizer/src/catalog.ts`, `memory-store.ts` | 카탈로그 모델·참조 무결성·원자적 저장 계약 및 테스트용 구현 |
| `packages/media-organizer/src/scan.ts`, `ingest.ts` | 파일 읽기 계약, 임시 스캔, 검증·등록·항목별 Job 결과 |
| `packages/media-organizer/src/metadata.ts`, `rules.ts` | 후보·사용자 수정·분류 규칙 |
| `packages/media-organizer/src/search.ts` | MiniSearch 래퍼와 구조화된 필터, 저장된 검색 |
| `packages/media-organizer/src/plans.ts`, `editor-contract.ts` | 편집기 독립 분류안, 어댑터 계약, 사전 검증·재시도 판정 |
| `packages/media-organizer/src/snapshot.ts`, `relink.ts` | 검증된 교환 문서, 명시적 경로 재연결 |
| `packages/media-organizer/src/index.ts`, `testing/fixtures.ts` | 공개 API와 결정적 테스트 데이터 |
| `packages/media-organizer/src/*.test.ts`, `search.bench.ts` | 기능·계약·전체 흐름 검증과 성능 계측 |
| `docs/research/2026-10-03-media-organizer-runtime.md` | 후속 실측 결과. 실행 전에는 생성하지 않음 |

모든 `.test.ts`는 대응하는 구현 옆에 둔다. 테스트 fixture에는 실제 촬영 파일 대신 작은 고정 데이터와 주입된 읽기 실패·파일 변경을 사용한다. 실제 미디어 자료는 후속 provider 검증에서 추가한다.

## Task 1: Core 미디어 교환과 정확한 시간 변환

**Files:** Create `packages/core/src/time-json.ts`, `media-document.ts`, `time-json.test.ts`, `media-document.test.ts`. Modify `time.ts`, `validation.ts`, `validation.test.ts`, `index.ts`, `public-api.test.ts`.

**Interfaces:**
- Consumes: 기존 `MediaTime`, `TimeRange`, `MediaAssetSchema`, `ClipReferenceSchema`, `CORE_SCHEMA_VERSION = "1.0.0"`.
- Produces: `WireMediaTime = {ticks: string; timebase: Rational}`; `encodeMediaTime(value: MediaTime): WireMediaTime`; `decodeMediaTime(input: unknown): MediaTime`.
- Produces: `addMediaTime(a: MediaTime, b: MediaTime): MediaTime`; `validateBoundedTimeRange(range: TimeRange, duration: MediaTime): TimeRange`.
- Produces: `MediaDocument = {schemaVersion: typeof CORE_SCHEMA_VERSION; kind: "media"; data: {assets: MediaAsset[]; clips: ClipReference[]}}`; `encodeMediaDocument(doc: MediaDocument): unknown`. `parseCoreDocument(input: unknown)`가 기존 project와 새 media의 판별 union을 반환한다.

- [x] **Step 1 — 실패 테스트 작성.** `time-json.test.ts`에서 다음 값을 왕복하고 `9007199254740993n`이 손실되지 않는지 확인한다. `"1.5"`, `"1e3"`, 숫자 ticks, 0 denominator는 거절한다. `media-document.test.ts`에서 중복 asset/clip ID와 없는 asset 참조를 거절한다.

  ```ts
  const time = { ticks: 9007199254740993n, timebase: { numerator: 1001, denominator: 30000 } };
  expect(decodeMediaTime(encodeMediaTime(time))).toEqual(time);
  expect(addMediaTime({ ticks: 1n, timebase: { numerator: 1, denominator: 2 } },
    { ticks: 1n, timebase: { numerator: 1, denominator: 3 } }))
    .toEqual({ ticks: 5n, timebase: { numerator: 1, denominator: 6 } });
  ```

- [x] **Step 2 — `pnpm --filter @pea/core test` 실행.** 새 공개 함수·media 문서 지원 부재로 실패해야 한다. 기존 성공 여부도 기록한다.
- [x] **Step 3 — 공통 기능 구현.** ticks는 `0` 또는 부호 있는 십진 정수 문자열만 인코딩한다. 임의 객체의 숫자 문자열을 bigint로 바꾸는 전역 reviver는 쓰지 않는다. 시간 합은 bigint 분수 연산 후 기약분수로 정규화하며 timebase가 안전한 정수 범위를 벗어나면 명시적으로 오류를 반환한다. 유효 사용 구간은 `0 ≤ start`, `duration > 0`, `start + duration ≤ mediaDuration`이다. Core의 기존 `validateTimeRange` 동작을 이보다 엄격한 규칙으로 조용히 바꾸지 않는다.
- [x] **Step 4 — 파싱 진입점 확장.** project 입력·오류 동작은 유지한다. 새 media 문서는 알려진 시간 경로만 디코딩하고 스키마·ID 참조를 검증한다. clip 범위 상한은 원본 길이를 가진 Organizer에서 추가 검증한다. 기존 독자는 새 kind를 거절한다는 점을 문서화하고 버전 문자열만 바꿔 호환성을 가장하지 않는다.
- [x] **Step 5 — `pnpm --filter @pea/core test`와 `pnpm --filter @pea/core typecheck` 실행.** 경계 밖·0 길이·서로 다른 timebase·알 수 없는 버전·기존 project가 기대대로 처리돼야 한다.
- [x] **Step 6 — 이 Task의 Core 파일만 stage하고 `feat(core): add media exchange and exact time serialization`로 커밋한다.**

## Task 2: 카탈로그 계약과 테스트용 저장소

**Files:** Create `packages/media-organizer/package.json`, `tsconfig.json`, `src/catalog.ts`, `memory-store.ts`, `catalog.test.ts`, `testing/fixtures.ts`, `index.ts`. 의존성 추가에 따른 루트 lockfile은 함께 기록한다.

**Interfaces:**
- Consumes: Core 공개 타입·검증 함수. 새 패키지는 `@pea/core: workspace:*`, 기존 Zod/Vitest/TypeScript 버전 계열을 따른다.
- Produces: 완성된 `CatalogState`는 `schemaVersion: "1.0.0"`, `catalogId`, `revision`과 `assets`, `clips`, `bindings`, `scans`, `metadata`, `annotations`, `ruleSets`, `savedSearches`, `jobs`, `organizationPlans`, `hostPlans`, `receipts`를 가진다. 이 Task에서는 assets/clips/bindings부터 만들고 나머지는 소유 Task의 실제 스키마와 함께 추가한다. 검증되지 않은 임의 객체를 공개 API로 받지 않는다.
- Produces: `AssetRecord = {asset: MediaAsset; fileRevision: number; locations: string[]; duration?: MediaTime; availability: "online"|"offline"|"unknown"; analysis?: {artifact: Artifact; providerVersion: string; settingsKey: string}}`; `clips`는 Core `ClipReference[]`.
- Produces: `HostBinding = {bindingId: string; clipId: string; adapterId: string; hostProjectKey: string; hostItemId: string; hostRevision: string}`.
- Produces: `CatalogStore.read(): Promise<CatalogState>`; `CatalogStore.commit(expectedRevision: number, next: CatalogState): Promise<CatalogState>`; `createMemoryCatalog(initial: CatalogState): CatalogStore`; `validateCatalog(state: CatalogState): CatalogState`.
- Produces: `IdFactory = () => string`; `emptyCatalog(catalogId: string): CatalogState`. 실제 실행은 UUID 발급기를 주입하고 테스트는 고정 UUID를 사용한다.

- [x] **Step 1 — 실패 테스트 작성.** `commits atomically and rejects stale revision`, `keeps separate clips for repeated imports`, `scopes host identity by adapter and project`, `does not expose mutable internal state`. 오래된 revision commit은 기존 상태·revision을 그대로 보존해야 한다. 같은 `(adapterId, projectKey, hostItemId)` 중복 binding만 거절하고 다른 프로젝트의 같은 hostItemId는 허용한다.
- [x] **Step 2 — 기존 패키지 형식으로 최소 manifest·tsconfig·test 스크립트를 만들고 `pnpm --filter @pea/media-organizer test` 실행.** 구현 부재로 실패해야 한다.
- [x] **Step 3 — 저장 계약 구현.** 성공한 commit만 revision을 1 증가시키며 ID 유일성, asset/clip/binding 참조, 알려진 duration에 대한 clip 범위를 검증한다. read·commit은 공유 가변 참조를 노출하지 않는다. 새 문서 컬렉션은 이후 Task의 스키마와 함께 추가한다.
- [x] **Step 4 — `pnpm --filter @pea/media-organizer test`와 `typecheck` 실행.** fixture는 `emptyCatalog`, 고정 UUID asset 두 개, 한 asset의 독립 clip 두 개를 제공한다. 이후 테스트가 이름·경로를 ID로 가정하지 않도록 한다.
- [x] **Step 5 — 관련 파일을 `feat(media): define catalog identity and store contract`로 커밋한다.**

## Task 3: 스캔·등록·재분석과 Job 결과

**Files:** Create `src/scan.ts`, `ingest.ts`, `ingest.test.ts`; Modify `catalog.ts`, `index.ts`, `testing/fixtures.ts`.

**Interfaces:**
- Consumes: `CatalogStore`, `IdFactory`, Core `MediaProbeProvider`, `ProviderContext`, `canTransitionJob`, `promoteArtifact`.
- Produces: `FileStamp = {size: bigint; mtimeNs: bigint; identity?: string}`; `ReadOnlyFiles.stat(uri: string): Promise<FileStamp>`; `ReadOnlyFiles.sha256(uri: string, ctx?: ProviderContext): Promise<string>`. 경로/URI는 입력값 그대로 보관한다.
- Produces: `ScanInput = {scanId: string; uri: string; existingAssetId?: string; sourceRange?: TimeRange}`; `ProbeRecord = {mediaKind: "video"|"audio"|"image"|"other"; duration?: MediaTime; frameRate?: FrameRate; width?: number; height?: number; audioChannels?: number; candidates: MetadataCandidate[]}`. candidate의 정확한 필드는 Task 4를 따른다.
- Produces: `IngestDependencies = {store: CatalogStore; files: ReadOnlyFiles; probe: MediaProbeProvider; ids: IdFactory; providerVersion: string; settingsKey: string}`; `ingest(inputs: ScanInput[], deps: IngestDependencies, ctx?: ProviderContext): Promise<IngestResult>`.
- Produces: `IngestResult = {job: Job; items: IngestItemResult[]}`; 각 item은 scanId, `registered|unchanged|offline|unsupported|changed_during_read|failed|cancelled`, 선택적 assetId/clipId, 구조화된 error를 가진다. 중간 `ScanRecord`는 상태·파일 stamp·다음 처리 단계·연결된 결과 ID를 저장한다.

- [x] **Step 1 — 실패 테스트 작성.** `never promotes partial hashes`, `rejects changed file after probe`, `retains prior valid artifact on probe failure`, `preserves distinct assets with identical hash`, `commits each completed item before cancellation`. 전체 SHA256는 64자리 16진수로 확인하며 이 강화는 Media의 provider 경계에 적용한다.
- [x] **Step 2 — `pnpm --filter @pea/media-organizer exec vitest run src/ingest.test.ts` 실행.** 새 테스트가 구현 부재로 실패하는지 확인한다.
- [x] **Step 3 — 한 항목씩 처리하는 기본 큐 구현.** 임시 scan 저장 → 앞 stamp → full hash/probe → 뒤 stamp → 구조·시간 검증 → 유효 결과 commit 순서다. 실패 시 이전 valid Artifact와 사용자 값은 유지한다. 내용 변경은 fileRevision 증가와 관련 자동 결과 무효화로 기록한다. stamp 전후 비교가 악의적 동시 변경까지 완전히 검출한다고 보장하지 않는다.
- [x] **Step 4 — 등록·재스캔 규칙 구현.** 재스캔은 명시적 existingAssetId를 검증해 재사용한다. 새 입력끼리 URI가 같으면 이번 요청에서만 중복을 제거한다. 다른 URI의 같은 hash는 별도 asset과 중복 후보다. clip은 양의 duration/유효 sourceRange가 있을 때만 생성한다. 이미지·길이 불명 미디어는 asset으로 보존·검색하며 임의 길이의 Core clip을 만들지 않는다. host import 후 유효 구간을 읽으면 별도 clip을 연결한다.
- [x] **Step 5 — Job 실패·취소·재시도 테스트 추가.** 일부 파일 실패는 `completed`와 항목별 실패로 기록한다. 결과 commit 실패는 전체 `failed`; Job 저장 자체도 실패하면 오류를 호출자에게 올려 성공을 보고하지 않는다. 취소는 다음 항목을 시작하지 않고 완료 항목을 유지한다. 완료/취소 Job 재시도는 새 Job, failed Job은 기존 transition 규칙에 맞는 attempt 증가로 처리한다. pending scan 재개는 같은 scanId의 이미 저장된 결과를 먼저 확인한다.
- [x] **Step 6 — 전체 Media 테스트·typecheck를 통과시키고 `feat(media): ingest verified assets with resumable item results`로 커밋한다.**

## Task 4: 사용자 수정·출처·분류 규칙

**Files:** Create `src/metadata.ts`, `rules.ts`, `metadata.test.ts`, `rules.test.ts`; Modify `catalog.ts`, `index.ts`.

**Interfaces:**
- Produces: `CatalogTarget = {kind: "asset"|"clip"; id: string}`. clip 값은 asset에서 상속하고 clip 범위의 사용자 수정이 우선한다.
- Produces: `MetadataField = "captureDate"|"deviceId"|"scene"|"take"|"mediaKind"`; `MetadataCandidate = {field: MetadataField; value: string; source: "probe"|"host"|"folderRule"|"filenameRule"; provenance: Provenance; rawValue?: string; timezone?: string}`. 모델명은 deviceId 후보가 아니다.
- Produces: `MetadataRecord = {target: CatalogTarget; field: MetadataField; candidates: MetadataCandidate[]; override?: {value: string; locked: true}}`; `resolveMetadata(record: MetadataRecord): {value?: string; status: "rule_match"|"user_confirmed"|"missing"|"conflict"; reasons: string[]}`.
- Produces: `Annotation = {id: string; target: CatalogTarget; kind: "tag"|"note"|"favorite"; value: string|boolean; range?: TimeRange; origin: "user"; reviewState: "confirmed"|"needs_review"}`. kind별 value 타입과 참조·시간을 검증한다.
- Produces: `RuleSet = {id: string; version: number; orderedFields: ("captureDate"|"deviceId"|"mediaKind")[]; rootLabel: string; pathMappings: {prefix: string; deviceId: string}[]; filenameRules: {pattern: string; field: MetadataField; group: number}[]}`; `classify(target: CatalogTarget, state: CatalogState, rules: RuleSet): Classification`.
- `Classification`은 `target`, `pathSegments: string[]`, `status`, `reasons`, `requiresReview: boolean`을 가진다. pathSegments는 논리 Collection 이름이며 실제 OS 경로가 아니다.

- [x] **Step 1 — 실패 테스트 작성.** `keeps locked override after new probe`, `does not infer capture date from mtime`, `keeps identical camera models unidentified`, `reports conflicting automatic dates`, `keeps a date without timezone unchanged`. 자동 후보가 두 값이면 conflict, 명시적 override가 있으면 user_confirmed여야 한다.
- [x] **Step 2 — `pnpm --filter @pea/media-organizer test` 실행해 새 요구가 실패하는지 확인한다.**
- [x] **Step 3 — 후보 병합·수정·분류 구현.** 기본 규칙은 `captureDate → deviceId → mediaKind`, root는 `Media Organizer`다. 누락값은 정확히 `촬영일 미확인`, `기기 미확인`; 미디어 종류는 `Video / Audio / Image / Other`로 출력한다. 누락·충돌은 확인 전 자동 적용에서 제외한다. override 제거는 자동 값으로 복귀하는 명시적 수정이다. 태그는 Bin을 복제하지 않는다.
- [x] **Step 4 — 명시적 사용자 규칙 검증.** 폴더 규칙은 경계가 맞는 prefix만 사용한다. 첫 파일명 규칙은 최대 128자 패턴과 2,048자 입력에 대해 리터럴 및 `{digits}`(ASCII 숫자 1–32개), `{letters}`(ASCII 영문 1–32개), `{date}`(유효한 YYYY-MM-DD)만 허용한다. 리터럴은 escape하고 전체 파일명에서 확장자를 뺀 문자열과 매칭한다. 자유 정규식은 받지 않는다. `SC{digits}_TK{digits}`의 group 1/2를 scene/take로 매핑하는 테스트와 잘못된 패턴 거절 테스트를 추가한다. 촬영일 규칙에는 date 그룹만 허용한다.
- [x] **Step 5 — 규칙 순서 변경·메모/태그 보존·asset/clip 상속·빈 문자열 비우기 테스트를 통과시킨다.** metadata 값 삭제와 빈 문자열 저장을 구분하고 분류 필드의 빈 문자열은 missing으로 처리한다.
- [x] **Step 6 — Media 테스트·typecheck 통과 후 `feat(media): preserve user metadata and explain classifications`로 커밋한다.**

## Task 5: MiniSearch 재사용과 저장된 검색

**Files:** Create `src/search.ts`, `search.test.ts`; Modify `package.json`, `catalog.ts`, `index.ts`, 루트 lockfile. Create `THIRD_PARTY_NOTICES.md`가 없다면 새로 만들고 있다면 해당 항목만 추가한다.

**Interfaces:**
- Consumes: Task 2–4 카탈로그와 effective metadata. 검색용 텍스트와 원본 URI는 분리한다.
- Produces: `SearchQuery = {text: string; filters: {captureDate?: string; deviceId?: string; mediaKind?: string; tags?: string[]; favorite?: boolean; availability?: "online"|"offline"|"unknown"}}`.
- Produces: `SearchHit = {target: CatalogTarget; mediaAssetId: string; score: number}`; `SearchIndex.rebuild(state: CatalogState): Promise<void>`; `SearchIndex.update(state: CatalogState, targets: CatalogTarget[]): void`; `SearchIndex.search(query: SearchQuery): SearchHit[]`; `createSearchIndex(): SearchIndex`.
- Produces: `SavedSearch = {id: string; name: string; query: SearchQuery}`. 검색 조건을 저장하고 재실행 시점의 카탈로그를 조회한다.

- [x] **Step 1 — 실패 테스트 작성.** `matches NFC and NFD Korean equally`, `intersects all structured filters`, `updates tags without stale hits`, `searches unbound still assets`, `rebuilds without changing results`. filename `서울_인터뷰_A001.mov`, query `서울 인터`, camera `CAM_A` 조합의 정답을 고정한다.
- [x] **Step 2 — 새 테스트 실패를 확인하고 `minisearch@7.2.0`을 정확한 버전으로 의존성에 추가한다.** 공식 코드·MIT 고지·설치 버전을 기록한다. 라이브러리 소스 복사본을 만들지 않는다.
- [x] **Step 3 — 공개 API 래퍼 구현.** 파일명·태그·메모·effective metadata만 색인한다. NFC 정규화·소문자화·공백/구두점 분리, `combineWith: "AND"`, 마지막 검색어만 prefix, fuzzy off를 사용한다. 빈 text는 필터 전체 조회다. 모든 filter는 교집합이고 tags 배열도 모두 포함해야 한다. 같은 score는 target 종류·ID로 안정 정렬한다.
- [x] **Step 4 — 색인 갱신 구현.** 문서 ID는 `clip:<clipId>`, clip 없는 asset은 `asset:<assetId>`다. asset 수정은 해당 asset의 모든 clip 문서에 전파한다. 최초 clip 생성 후 중복 asset 문서는 제거한다. `addAllAsync`, `replace`, `discard`를 재사용하고 캐시 실패는 카탈로그에서 재생성한다. 사용자 메모/경로의 원문을 정규화해 덮어쓰지 않는다.
- [x] **Step 5 — 전체 Media 테스트·typecheck를 통과시키고 `feat(media): reuse MiniSearch for catalog search`로 커밋한다.**

## Task 6: 검토 가능한 변경안과 편집기 계약

**Files:** Create `src/plans.ts`, `editor-contract.ts`, `plans.test.ts`, `editor-contract.test.ts`; Modify `catalog.ts`, `index.ts`, `testing/fixtures.ts`.

**Interfaces:**
- Produces: `OrganizationPlan = {id: string; catalogRevision: number; ruleSetId: string; ruleSetVersion: number; assignments: {target: CatalogTarget; pathSegments: string[]; tags: string[]}[]; issues: {target: CatalogTarget; code: string; reasons: string[]}[]}`; `buildOrganizationPlan(state: CatalogState, targets: CatalogTarget[], rules: RuleSet, acceptedUnknowns: CatalogTarget[], ids: IdFactory): OrganizationPlan`.
- Produces: `HostContext = {adapterId: string; hostProjectKey: string; hostRevision: string; catalogRevision: number; capabilities: CapabilityReport; bindings: HostBinding[]; items: HostItemSnapshot[]}`. `HostItemSnapshot`은 `hostItemId`, `itemRevision`, `kind: "clip"|"bin"|"unsupported"`, `parentItemId?`, `uri?`, `sourceRange?`, `metadata: MetadataCandidate[]`를 갖는다.
- Produces: `Capability = "hierarchy"|"tags"|"import"|"projectFields"|"reveal"|"rangeReveal"|"undo"`; `CapabilityReport`는 편집기 이름·appVersion·os·adapterVersion·revision과 각 Capability의 `supported|unsupported|unverified` 상태·이유를 가진다. 태그와 계층 지원은 별도다.
- Produces: `HostApplyPlan<TAction> = {id: string; organizationPlanId: string; adapterSchemaVersion: string; expectedContext: HostContext; operations: {id: string; target: CatalogTarget; expectedItemRevision?: string; dependsOn: string[]; requiredCapabilities: Capability[]; action: TAction}[]; compatibilityReport: {severity: "info"|"blocking"; code: string; targets: CatalogTarget[]}[]}`. `TAction`은 각 adapter가 소유하는 JSON 직렬화 가능한 타입이며 SDK 객체는 담지 않는다. 카탈로그의 hostPlans는 공통 envelope과 JSON action으로 보존하고 실제 실행 시 adapter가 자신의 버전·action 스키마를 재검증한다.
- Produces: `ApplyReceipt = {id: string; hostPlanId: string; status: "exported"|"awaiting_import"|"verified_applied"|"partial"|"failed"; operations: {id: string; state: "pending"|"exported"|"awaiting_import"|"verified_applied"|"skipped"|"blocked"|"failed"; reason?: string}[]; createdBindings: HostBinding[]}`.
- Produces: `EditorAdapter<TAction>`의 async methods: `getCapabilities(context: HostContext): Promise<CapabilityReport>`, `readContext(selection: {kind: "selected"|"project"}): Promise<HostContext>`, `planApply(plan: OrganizationPlan, context: HostContext): Promise<HostApplyPlan<TAction>>`, `apply(plan: HostApplyPlan<TAction>): Promise<ApplyReceipt>`, `verify(receipt: ApplyReceipt): Promise<ApplyReceipt>`, `reveal(binding: HostBinding, range?: TimeRange): Promise<{status: "opened"|"unsupported"|"failed"; reason?: string}>`.
- Produces: `preflight<T>(plan: HostApplyPlan<T>, current: HostContext): {ok: boolean; reasons: string[]}`; `retryableOperationIds<T>(plan: HostApplyPlan<T>, receipt: ApplyReceipt | undefined, observed: Record<string, "at_target"|"at_expected"|"changed"|"unknown">): string[]`.

- [x] **Step 1 — 실패 테스트 작성.** `builds a deterministic preview without mutations`, `excludes unresolved conflicts`, `blocks project or capability changes`, `does not treat export as verified`, `retries only observed unapplied work`. 사용자 검토 후 다른 프로젝트로 전환하면 preflight false; exported receipt는 verified_applied가 될 수 없다.
- [x] **Step 2 — `pnpm --filter @pea/media-organizer test` 실행해 새 계약·함수 부재를 확인한다.**
- [x] **Step 3 — 공통 변경안·사전 검사 구현.** 선택 범위만 포함하고 생성 함수는 현재 카탈로그를 변경하지 않는다. caller가 organizationPlans/hostPlans에 검토된 계획을 저장하고 발급한 ID를 재시도에 재사용한다. 이 저장으로 증가한 revision을 최종 expectedContext에 기록해 계획 저장 자체가 stale 판정의 원인이 되지 않게 한다. unknown 분류 수용은 target별로만 적용하며 conflict에는 사용하지 않는다. project/catalog/capability revision과 관련 binding revision을 재검사하고 blocked 기능을 포함하면 실행 대상에서 제외한다.
- [x] **Step 4 — receipt·재시도 규칙 구현.** `at_target`은 성공 확인 또는 건너뜀, `at_expected`인 failed/pending만 재실행 후보다. `changed/unknown`은 새 확인이 필요하다. 앞선 dependency가 실패/불명확하면 후속 작업도 실행하지 않는다. receipt 없는 작업은 실행 전에 observed 상태를 읽는다. 이 함수는 호스트를 직접 변경하지 않는다.
- [x] **Step 5 — 계층형·태그 전용 테스트 어댑터 추가.** 같은 OrganizationPlan을 각각 변환하고 태그 전용 대상의 계층 손실을 blocking으로 보고한다. 실제 FCP/Resolve 이름을 테스트 어댑터의 지원 제품명으로 쓰지 않는다. 같은 호스트 ID가 다른 프로젝트에 있거나 카탈로그가 변경된 경우도 차단한다.
- [x] **Step 6 — 테스트·typecheck 통과 후 `feat(media): define reviewed organization and editor apply contracts`로 커밋한다.**

## Task 7: 카탈로그 교환·재연결과 사용자 값 보존

**Files:** Create `src/snapshot.ts`, `relink.ts`, `snapshot.test.ts`, `relink.test.ts`; Modify `catalog.ts`, `index.ts`.

**Interfaces:**
- Consumes: Core media 문서 codec, CatalogState 전체 스키마, read-only stat/hash 계약.
- Produces: `exportCatalog(state: CatalogState): string`; `importCatalog(json: string): CatalogState`. envelope은 `{schemaVersion: "1.0.0", producer: {module: "media-organizer", version: string}, core: MediaDocument의 wire 형식, organizer: 확장 레코드}`다. Core asset·clip을 확장 레코드 안에 중복 저장하지 않는다.
- Produces: `RelinkRequest = {mediaAssetId: string; fromUri: string; toUri: string; expectedFileRevision: number}`; `prepareRelink(state: CatalogState, request: RelinkRequest, files: ReadOnlyFiles): Promise<{request: RelinkRequest; status: "verified"|"ambiguous"|"mismatch"|"offline"; observedSha256?: string}>`; `commitRelink(store: CatalogStore, request: RelinkRequest, files: ReadOnlyFiles): Promise<CatalogState>`.

- [x] **Step 1 — 실패 테스트 작성.** `round trips bigint times and user overrides`, `rejects unknown catalog version without modifying store`, `rejects missing asset references`, `preserves identity when location changes`, `requires confirmation for case-folding ambiguity`.
- [x] **Step 2 — 새 테스트 실패를 확인한다.** 알 수 없는 버전·깨진 문서 입력은 empty catalog를 반환하지 않고 명시적 오류여야 한다.
- [x] **Step 3 — 경로별 codec 구현.** Core 시간 codec을 asset duration·annotation range·host plan의 expectedContext sourceRange에도 사용하고 FileStamp bigint도 지정한 필드만 십진 문자열로 변환한다. 계획·receipt 참조를 검증하고 adapter action의 JSON은 보존한다. import만으로 알 수 없는 adapter 버전의 실행을 허용하지 않는다. import는 전체 문서를 검증한 뒤 caller에게 반환하며 자동 commit하지 않는다. 실제 버전 변환기가 없는 미래 버전은 마이그레이션 지원이라고 표시하지 않는다. SQLite 백업·migration은 후속 저장소 Task다.
- [x] **Step 4 — 재연결 구현.** 명시적 asset ID와 원래 URI·revision, 새 위치 full hash를 확인한다. commit 때도 다시 확인하고 CAS 저장한다. ID·사용자 주석은 유지하고 새 URI를 locations 및 Core canonical uri에 반영한다. 애매한 경로 후보를 자동 선택하지 않는다. 다른 내용으로 교체는 relink가 아니라 Task 3의 명시적 재분석이다.
- [x] **Step 5 — 테스트·typecheck 통과 후 `feat(media): validate catalog exchange and explicit relinking`로 커밋한다.**

## Task 8: 전체 흐름·독립성·성능 기준 확인

**Files:** Create `src/workflow.test.ts`, `public-api.test.ts`, `boundaries.test.ts`, `search.bench.ts`, `README.md`; Modify 공개 `index.ts`만 필요한 범위에서 추가한다.

**Interfaces:** 기존 Task의 공개 API만 사용한다. 새 생산용 계약을 추가하지 않는다.

- [x] **Step 1 — 전체 흐름 테스트 작성.** `registers, overrides, classifies, searches and reviews a catalog`에서 두 카메라·동일 이름 파일·오프라인·서로 다른 host binding을 넣고 ID와 사용자 값을 끝까지 추적한다. snapshot export/import 후 같은 질의 결과·분류안·binding을 얻어야 한다. 테스트 어댑터의 apply 뒤 verify가 끝나야 receipt가 verified_applied가 된다.
- [x] **Step 2 — 실패·경계 테스트 작성.** source mutation 메서드 없이 read-only provider로 모든 엔진 경로를 실행한다. 실제 import graph의 production 파일에 `premierepro`, `uxp`, `node:fs`, native DB/decoder import가 없어야 한다. 테스트 전용 Node API는 이 제한에서 제외한다. 외부 의존성의 UXP 호환성은 별도 bundle/runtime 검증 사항으로 남긴다.
- [x] **Step 3 — 공개 export·통합 오류만 수정한다.** test double 성공을 Premiere 성공으로 출력하는 문구나 문서가 있으면 고친다. README에 재사용 라이브러리, 영구 저장소 미연결, 실제 host 미연결을 명시한다.
- [x] **Step 4 — 500개 기준 검색을 계측한다.** `pnpm --filter @pea/media-organizer exec vitest bench --run src/search.bench.ts`로 실행한다. 날짜·카메라·태그·한글 파일명이 섞인 결정적 fixture, 20회 warm-up 후 200회 필터 질의의 실제 경과시간을 기록한다. 인덱싱 완료 후 p95 목표는 300ms. 하드웨어·런타임·자료 크기를 기록하며 CI의 임의 절대시간 실패 조건으로 만들지 않는다. Node 수치는 Premiere 수치와 따로 보관한다.
- [x] **Step 5 — `pnpm test`와 `pnpm typecheck` 실행.** 기존 Core·Sync와 새 Media 모두 통과해야 한다. 설치/환경 실패는 기능 통과와 구분해 보고한다. 이 결과는 순수 엔진 검증이며 Premiere 적용 검증이 아니다.
- [x] **Step 6 — 관련 파일을 `test(media): verify portable organizer workflow`로 커밋하고 실제 결과·남은 호스트 검증을 기록한다.**

## 후속 런타임 검증과 제품 구현 연결

아래는 1단계 승인에 포함된 구현 체크박스가 아니라, v0.1 제품을 완성하기 위해 필요한 다음 계획의 입력이다. 실측 결과를 기록한 후 정확한 native/provider 파일 배치와 빌드·배포 명령을 확정한다. API 문서 존재만으로 통과시키지 않는다.

| 검증 | 재사용할 실제 코드·경로 | 통과 조건과 실패 시 처리 |
|---|---|---|
| UXP에서 Core+Media bundle | 기존 workspace + MiniSearch 공개 API | host에서 import·검색·메모리 사용 확인. Node 의존성 유입 시 adapter 경계에서 제거; MiniSearch 부적합 시 같은 SearchIndex를 FTS5로 교체 |
| 파일 부분 읽기·해시 | mediainfo.js `analyzeData`, `readChunk` 예제 | 대형 파일을 전체 메모리에 로드하지 않고 seek·취소·full SHA256 가능. 부족하면 native provider 사용 |
| 메타데이터 | mediainfo.js 또는 MediaInfoLib/ffprobe | 고정 영상·오디오·VFR·손상 파일의 필수 정보·오류가 ProbeRecord와 일치. 직접 파서 작성 금지 |
| SQLite/Hybrid | SQLite 공개 API + Adobe Hybrid SDK | 1 writer, crash 후 commit 복구, 디스크 부족·권한 거부·schema backup/migration 검증. 메모리 저장소로 제품 출시하지 않음 |
| Premiere ID·프로젝트 바인딩 | Adobe `projectPanel.ts`의 항목 순회·`getId` | 재개방/Save As/프로젝트 복사 시 충돌 판정. 안정적 식별이 확인되지 않으면 자동 재연결 대신 사용자 확인 |
| 실제 Bin 반영 | `createBinAction`, `createMoveItemAction`, `importFiles` | binding ID·부모 관계로 식별, 시퀀스 참조 유지, 같은 이름 사용자 Bin 보존, 중단/재시도 중복 없음 |
| 프로젝트 필드 | `batchUpdate.js`의 XMP 속성 단위 action | `{bindingId, item, metadata}` 묶음 유지, 선택 필드만 변경, 원본/sidecar 무변경과 Undo 확인. 실패한 필드 쓰기는 제공하지 않음 |
| 미리보기·썸네일 | `SourceMonitor.openProjectItem`; 검증된 decoder | 하위 Bin·같은 이름을 정확한 binding으로 열기, 코덱별 썸네일 캐시·오프라인 표시. 실패한 썸네일 때문에 메타데이터를 폐기하지 않음 |

후속 제품 구현에서는 `adapters/premiere`에 위 실제 호출을, `apps/premiere-panel`에 라이브러리·자동 정리·확인 필요·작업 기록 탭을 둔다. `createBin/importFile/moveItem/setProjectFields` 액션은 Premiere adapter의 `TAction` union으로 정의한다. 각 작업의 예상 상태·dependency·실제 결과를 SQLite에 기록하고 호스트를 재조회한다. import Boolean만으로 성공을 확정하지 않는다.

실제 Source Monitor 구간 이동, OS별 native provider, SQLite 마이그레이션·백업·재시작 내구성, 파일 해시·썸네일 출력의 원본 무변경은 이 엔진 계획으로 검증되지 않는다. 설계 13절의 제품 완료 기준은 후속 통합 시험까지 유지한다.

## 자체 검토 기록

- 설계 1–8절의 호스트 독립·ID·시간·사용자 수정·분류·검색 계약은 Task 1–7에 연결했다. SQLite/UXP/썸네일/UI는 후속 단계로 명시했다.
- 설계 9–10절의 Job·부분 실패·검토·재시도 판단은 Task 3·6·8에서 확인한다. 실제 crash·Undo·호스트 적용은 후속 시험이다.
- 설계 11–14절의 버전별 호환·다른 편집기·Sync/Subtitle 확장은 경계를 보존한다. 실제 어댑터·AI 구현을 이번 완료 조건으로 가장하지 않는다.
- Core의 기존 schemaVersion은 `1.0.0`이다. 프로젝트 계약과 Job 상태를 변경하지 않고 media 문서 종류를 추가한다.
- Task 3의 MetadataCandidate는 Task 4에서 확정하므로 실행 시 Task 4의 타입 선언을 먼저 읽는다. 테스트에 필요한 최소 스키마 선언은 Task 3 커밋에 포함하고 동작은 Task 4에서 완성한다.
- 실행 결과는 [2026-10-07 검증 기록](../../research/2026-10-07-media-organizer-validation.md)을 따른다. 기존 기준 스냅샷 대신 Core가 동일한 최신 Sync 통합 커밋 131f050을 기반으로 구현했다.
