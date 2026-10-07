# Media Organizer — GitHub 구현 코드 검색 결과

작성일: 2026-10-03

2026-10-07 후속: @pea/core 확장과 MiniSearch 7.2.0 공개 API 연결을 로컬 엔진에 구현했다. 아래 10월 3일 기록은 당시 소스 검토 범위이며, Adobe·미디어 분석 후보의 실제 연결은 후속 작업이다. [검증 기록](2026-10-07-media-organizer-validation.md).

범위: 사용자 지정 저장소의 기존 구현과 외부 GitHub 공개 소스. 아래 파일은 검색 결과에서 경로를 확인한 후 소스 내용을 읽었다. 이번 작업은 코드 검색·정적 검토이며, 외부 코드를 설치·실행하거나 Media 제품에 통합한 결과는 아니다.

## 1. 검색 방법과 확인 기준

GitHub 코드 검색에서 저장소 범위를 지정하고 함수 이름으로 검색했다. README에 적힌 기능만으로 재사용 대상으로 확정하지 않고, 구현과 의존 환경을 확인했다.

| 저장소 | 실제 검색어 | 확인한 커밋 |
|---|---|---|
| AdobeDocs/uxp-premiere-pro-samples | `createBinAction`, `createSetProjectMetadataAction`, `importFiles`, `setPosition` | `173a4a3d33bb9ac4ced7897e86f227923c9725f9` |
| buzz/mediainfo.js | `analyzeData`, `locateFile` | `b8e5119d819db486c4106b882e07e94a33e1b6e3` |
| lucaong/minisearch | `addAllAsync` | `3d239d1c3ae7aef1bf5d8945dd7b5f0709f646f5` |
| mifi/lossless-cut | `readFileMeta`, `runFfprobe` | `70f2663a7a7c995903701acd2f616d057f4fdc2f` |
| plutoan12/premiere-editing-assistantt | 로컬에 가져온 개발 브랜치의 파일 목록·공개 API·구현 직접 확인 | `9f2119ce55bd090c86e84b058725776a9405228c` |

첫 LosslessCut 검색은 UI의 사용 지점을 찾았고, `runFfprobe` 검색으로 실제 처리 파일에 도달했다. 외부 버전 표시는 확인한 커밋의 `package.json` 기준이며 최신 배포판을 의미하지 않는다.

## 2. Premiere 항목 수집·Bin 정리

소스: [projectPanel.ts](https://github.com/AdobeDocs/uxp-premiere-pro-samples/blob/173a4a3d33bb9ac4ced7897e86f227923c9725f9/sample-panels/premiere-api/src/projectPanel.ts)

| 함수와 위치 | 확인한 동작 | 적용 방법 |
|---|---|---|
| `getSelectedProjectItems` — 38행 | ProjectUtils로 현재 선택과 항목 목록을 읽음 | 입력 어댑터의 출발점으로 사용 |
| `getClipProjectItem` — 58행 | 하위 폴더를 탐색해 첫 미디어 항목을 반환 | 폴더 탐색·타입 확인을 참고하되 전체 선택 항목을 반환하도록 구성 |
| `createBin` — 106행 | `lockedAccess`와 `executeTransaction`에서 Bin 생성 | 호출 순서를 재사용하고 부모·이름·작업 ID를 인자로 받도록 변경 |
| `moveItem` — 300행 | 예제 Bin을 생성한 뒤 다른 Bin으로 이동 | `createMoveItemAction` 사용 부분을 적용 |
| `getMediaInfo` — 617행 | media의 시작과 길이를 읽음 | 공통 시간 형식으로 변환하는 어댑터에 반영 |

그대로 복사하면 맞지 않는 부분도 확인했다. Bin 이름이 `Bin1`, `Bin5`, `Bin6`로 고정돼 있고, 이동 예제는 이름으로 항목을 찾으며 시연용 타이머를 사용한다. 제품에서는 HostBinding으로 항목을 찾고, 명시적 결과를 기다린 뒤 재조회해야 한다. 길이를 부동소수 초로만 전달하는 예제도 Core의 시간 규격에 맞게 바꾼다.

권장 반영 위치: `adapters/premiere`의 항목 수집·분류 적용 구현. 분류 규칙과 카메라 추정은 이 파일에서 가져오는 기능이 아니며 Media 엔진이 담당한다.

## 3. 메타데이터 일괄 수정

소스: [metadata-handler/src/batchUpdate.js](https://github.com/AdobeDocs/uxp-premiere-pro-samples/blob/173a4a3d33bb9ac4ced7897e86f227923c9725f9/sample-panels/metadata-handler/src/batchUpdate.js#L122)

- `getSetMetadataAction` — 122행: `uxp.xmp.XMPMeta`로 해당 속성을 수정하고, `updatedFields`를 지정해 프로젝트 메타데이터 Action을 생성한다.
- `getProjectItemMetadatas` — 140행: 여러 항목의 프로젝트 메타데이터를 읽는다.
- `updateMetadata` — 175행: 값을 준비하고 여러 Action을 트랜잭션으로 반영하는 흐름이다.

**재사용할 핵심은 속성 단위 수정과 트랜잭션 구성이다.** UI의 DOM ID·일련번호 입력 처리와 제품의 검토 흐름은 분리한다. 빈 문자열을 속성 삭제로 처리하는 예제의 의미를 그대로 상속하지 않고, 값 비우기와 삭제를 명시적으로 구별한다.

또한 이 파일은 clip 항목의 메타데이터만 배열에 추가하고 나중에는 원래 항목 배열의 같은 인덱스를 사용한다. Bin 등이 섞인 입력에서는 대응 관계가 어긋날 수 있으므로, Media에서는 `{bindingId, projectItem, metadata}`를 한 레코드로 유지한다. 선택 항목 처리의 실제 조합은 구현 시 검증한다.

## 4. 가져오기와 미리보기

소스: [import.ts](https://github.com/AdobeDocs/uxp-premiere-pro-samples/blob/173a4a3d33bb9ac4ced7897e86f227923c9725f9/sample-panels/premiere-api/src/import.ts#L23), [sourceMonitor.ts](https://github.com/AdobeDocs/uxp-premiere-pro-samples/blob/173a4a3d33bb9ac4ced7897e86f227923c9725f9/sample-panels/premiere-api/src/sourceMonitor.ts#L92)

`importFiles`는 파일 경로 배열로 가져오기를 호출한다. 현재 예제의 `targetBin`은 기본 루트이므로 우리가 만든 대상 Bin을 받게 바꾸고, 반환 Boolean에 더해 실제 새 항목을 조회해 클립 ID와 연결한다.

`openProjectItem`은 루트 항목을 이름으로 비교해 Source Monitor에서 연다. 이 래퍼는 동일 이름과 하위 Bin을 다루는 제품에 그대로 맞지 않는다. HostBinding으로 얻은 실제 ProjectItem을 `SourceMonitor.openProjectItem`에 넘긴다. 140행의 `setPosition` 호출은 Core 시간값을 Premiere 시간으로 변환한 후 사용한다.

## 5. 미디어 분석 — mediainfo.js

소스: [src/MediaInfo.ts](https://github.com/buzz/mediainfo.js/blob/b8e5119d819db486c4106b882e07e94a33e1b6e3/src/MediaInfo.ts#L94), [파일 조각 읽기 예제](https://github.com/buzz/mediainfo.js/blob/b8e5119d819db486c4106b882e07e94a33e1b6e3/examples/browser-umd/example.js#L9), [WASM 로딩 예제](https://github.com/buzz/mediainfo.js/blob/b8e5119d819db486c4106b882e07e94a33e1b6e3/examples/vite-react/src/App.tsx#L16)

`analyzeData(size, readChunk)`가 필요한 위치의 데이터를 요청하고 `readChunk(chunkSize, offset)`가 Uint8Array를 반환한다. 라이브러리가 버퍼 파싱과 이동 위치를 관리하므로 컨테이너 파서를 직접 작성할 필요를 줄일 수 있다. 분석 결과를 object로 받는 분기도 있다.

Media에서는 `MediaProbeProvider` 구현으로 감싸 파일 접근, 취소 확인, 결과 정규화만 연결한다. 현재 구현은 한 인스턴스에서 동시 분석을 거부하므로 제한된 작업 큐 또는 독립 인스턴스를 사용한다. 중단은 다음 청크 읽기에서 확인하도록 설계하고 네이티브 분석 도중 즉시 중단된다고 보장하지 않는다.

검증 조건은 UXP의 WASM 로딩·파일 부분 읽기·패키지 번들링이다. 브라우저 예제의 동작이 Premiere 패널의 동작을 입증하지는 않는다. 해당 환경에서 맞지 않으면 같은 provider 경계 뒤의 네이티브 MediaInfoLib 또는 ffprobe를 비교한다. 이 라이브러리의 메타데이터 분석과 썸네일 생성은 별도 기능이다.

확인한 package.json: 버전 `0.3.8`, 라이선스 `BSD-2-Clause`, WASM 파일의 공개 export가 있다. [패키지 정보](https://github.com/buzz/mediainfo.js/blob/b8e5119d819db486c4106b882e07e94a33e1b6e3/package.json)

## 6. 파일명·태그·메모 검색 — MiniSearch

소스: [src/MiniSearch.ts](https://github.com/lucaong/minisearch/blob/3d239d1c3ae7aef1bf5d8945dd7b5f0709f646f5/src/MiniSearch.ts)

| 함수와 위치 | 활용 |
|---|---|
| `addAllAsync` — 803행 | 문서를 나누어 색인하고 청크 사이에 이벤트 처리를 허용 |
| `replace` — 1024행 | 태그·메모 수정 후 해당 문서 색인 교체 |
| `search` — 1360행 | 필드 검색과 결과 필터. prefix·fuzzy 설정 사용 가능 |
| `autoSuggest` — 1459행 | 입력 중 검색어 제안 |
| `toJSON` — 1843행 | 재생성 가능한 검색 캐시 직렬화 |

`clipId`를 문서 ID로 쓰고 파일명·태그·메모를 검색 필드로 매핑한다. 날짜·카메라 조건은 구조화된 필터로 처리한다. 원본 카탈로그가 기준 데이터이며 색인은 언제든 재생성할 수 있어야 한다.

기본 tokenizer는 공백·구두점 기준이므로 한국어 형태소·의미 검색을 제공한다고 표시하지 않는다. filename의 구분자와 한글 정규화 사례를 검증해야 한다. SQLite FTS5와 비교할 경량 검색 대안이며 둘을 무조건 함께 탑재하지 않는다.

확인한 package.json: 버전 `7.2.0`, 라이선스 `MIT`, runtime dependencies는 빈 객체다. UXP 번들 호환성은 별도 검증한다. [패키지 정보](https://github.com/lucaong/minisearch/blob/3d239d1c3ae7aef1bf5d8945dd7b5f0709f646f5/package.json)

## 7. ffprobe 호출·썸네일 구현 사례 — LosslessCut

소스: [src/main/ffmpeg.ts](https://github.com/mifi/lossless-cut/blob/70f2663a7a7c995903701acd2f616d057f4fdc2f/src/main/ffmpeg.ts)

- `runFfprobe` — 195행: 인자 배열로 프로세스를 실행하고 제한 시간을 넘기면 종료하며 finally에서 타이머를 해제한다.
- `captureFrames` — 489행: 지정 구간·필터로 프레임을 추출하고 진행을 전달한다.
- `captureFrameToFile` — 566행: 지정 시각의 한 프레임을 파일로 출력한다.
- `readFormatData` — 581행: ffprobe의 JSON 출력을 읽고 format 정보를 해석한다.

이 소스는 Electron/Node 환경과 `execa`를 사용한다. UXP에 직접 넣는 코드가 아니며 프로세스 실행이 가능한 별도 provider 구현의 참고 대상이다. 출력 경로를 덮어쓰는 옵션이 있으므로 제품에서는 캐시 전용 경로만 사용해야 한다.

확인한 package.json의 라이선스는 `GPL-2.0-only`다. 직접 복사·결합 여부는 제품의 배포 방식과 호환성을 검토한 뒤 결정하고, 현재는 실행·시간 제한·프레임 추출 설계의 참고 대상으로 둔다. [패키지 정보](https://github.com/mifi/lossless-cut/blob/70f2663a7a7c995903701acd2f616d057f4fdc2f/package.json)

## 8. 도입 순서와 직접 개발할 부분

1. **기존 @pea/core 사용:** 미디어·클립 ID, 시간, Job, Artifact, 검증 진입점, 테스트·CI 구성을 공유한다.
2. **Adobe 호출 패턴 적용:** 선택 항목 수집, Bin 생성·이동, 선택 필드 갱신, 가져오기, 미리보기. 고정 이름과 예제 UI를 제거하고 HostBinding·변경안·재시도와 결합한다.
3. **미디어 provider 선택:** mediainfo.js와 기존 native/ffprobe 경로 중 실제 파일·배포 환경에 맞는 구현을 사용한다. 파일 파서를 새로 만드는 것은 기존 구현으로 해결할 수 없는 경우에만 검토한다.
4. **검색 provider 선택:** 소스 검토 후 [첫 엔진 구현 계획](../superpowers/plans/2026-10-03-media-organizer-engine.md)에서 MiniSearch 7.2.0 공개 API를 우선 구현하기로 정했다. TypeScript 엔진에서 기존 색인·검색을 바로 검증할 수 있다는 판단이다. SQLite는 기준 카탈로그를 저장하고, FTS5는 MiniSearch가 실제 호스트·검색 자료 검증을 통과하지 못할 때 대안으로 둔다. 이 결정은 구현 순서이며 UXP 호환성 검증 완료를 의미하지 않는다.

Media 전용으로 필요한 부분은 촬영일·카메라·씬·테이크 분류 규칙, 사용자 수정 잠금, 충돌 검토, 공통 ID 연결, 변경 전후 비교와 재실행 처리다. 검색한 코드가 이 요구 전체를 이미 해결한다고 주장하지 않는다.

도입할 때는 검색·검토한 커밋과 실제 설치할 버전을 구분해 기록하고, 라이선스·파일별 고지를 보존한다. 라이브러리는 가능하면 공개 API로 의존하고 소스 복사·fork는 필요한 부분으로 제한한다. 이번 문서에 소개한 후보는 코드 확인을 마쳤으며 실제 채택은 호환성 검증 후 이루어진다.
