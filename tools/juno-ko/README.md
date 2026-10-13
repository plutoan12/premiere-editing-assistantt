# Juno 한글 자막 검증 도구

기존 `feat/graphics-engine`의 프리미어 쓰기 경로를 수정하지 않는, 독립 브라우저 미리보기다.
Tscaps Juno의 팝업·그림자·단어 강조를 참고했다. Tscaps 엔진/Studio를 설치하거나
프리미어 패널에 CSS를 넣은 것이 아니다. `.mogrt`와 글꼴 파일은 포함하지 않는다.

## 1. 미리보기 만들기

저장소 루트에서 Node.js 22로 실행한다. 새 런타임 의존성은 없다.

```sh
node tools/juno-ko/build.mjs /tmp/juno-ko-preview-01.html
```

HTML을 일반 브라우저에서 연다. 동일 경로가 있으면 빌드가 `EEXIST`로 중단된다.
기존 파일을 덮어쓰지 말고 새 출력 이름을 사용한다. 생성한 HTML에는 라이선스 고지도 포함된다.

미리보기에서 문구, 가로/세로, 요청 글꼴, 글자 크기, 강조색을 변경한다.
글꼴은 기기에 설치되어 있어야 한다. 선택한 글꼴이 없으면 대체 글꼴로 보일 수 있다.
글자 크기는 두 출력 비율 모두 픽셀 단위이고 자동 축소하지 않는다.
한글은 NFC로 정규화하며, 명시적인 줄바꿈과 이모지 조합을 보존한다.
단어 경계를 우선하고 긴 단어는 grapheme 경계에서 나눈다. 정교한 한국어 금칙 처리는 범위 밖이다.
두 줄/폭을 초과하면 미리보기와 JSON 저장을 차단하며 원문을 자르지 않는다.

강조 타이밍은 4초짜리 시연이다. 음성 인식, 실제 단어별 시간, 영상 입력/렌더링은 제공하지 않는다.
Canvas의 실제 선택 글꼴 폭으로 계산하지만 Premiere의 글자 폭과 동일하다고 보장하지 않는다.

## 2. 자동 검사

외부 의존성이 없는 기능 테스트:

```sh
node --test tools/juno-ko/contract.node.mjs
```

기존 워크스페이스 의존성 설치 후, 실제 어댑터 계약까지 검사:

```sh
pnpm test:juno-ko
pnpm test
pnpm typecheck
```

`native-contract.node.mjs`는 저장소의 실제 `uxp-mogrt.ts`와 `uxp-mogrt-text.ts`를
기존 TypeScript 의존성으로 임시 변환하여, JSON 수신과 쓰기 잠금 유지 여부만 검사한다.
Adobe SDK를 호출하지 않으므로 이 결과는 Premiere 실행 성공의 증거가 아니다.

선택적 브라우저 검사에는 Python Playwright 및 Chromium이 필요하다.
이미 준비된 검증 환경에서 다음과 같이 실행한다.

```sh
python tools/juno-ko/check_browser.py --preview /tmp/juno-ko-preview-01.html --evidence-dir /tmp/juno-ko-evidence-01
```

자체 포함 HTML을 Chromium에 로드해 화면 안의 실제 자막 위치, 최대 팝업 상태,
가로·세로 안전영역, 한글/이모지, 긴 문장 차단, HTML 삽입 방지, JSON 다운로드,
390px 화면 가로 넘침을 검사한다. 파일 URL 진입이나 Safari는 검사하지 않는다.

## 3. 프리미어 테스트 준비

'프리미어 문구 테스트 준비'에 실제 보유한 MOGRT의 ID·버전·절대경로를 입력한다.
도구는 ID/버전을 추정하지 않으며 파일 존재나 진위를 검사할 수 없다.
'문구 테스트 JSON 저장'은 기존 패널의 `editable-text-draft` 계약을 만든다.
자동 줄바꿈, 글꼴, 색상, 크기, 애니메이션은 이 JSON에 포함하지 않는다.
CSS를 MOGRT로 변환하거나 기본 Juno MOGRT를 제공하는 기능이 아니다.

30,000/1,001fps에서 시작 60프레임, 길이 90프레임을 bigint로 계산한다.
부동소수점 29.97로 시간을 근사하지 않는다. 시퀀스 설정은 선택한 가로/세로를 따른다.

맥 연결 후 별도의 폐기 가능한 테스트 프로젝트에서 진행한다.

1. 기존 `apps/premiere-graphics-panel`을 빌드하고 UXP Developer Tools로 로드한다.
2. JSON을 '미리보기 계획 불러오기'로 읽은 다음, ID/버전이 일치하는 실제 MOGRT를 고른다.
3. 새 시퀀스에서 원본 템플릿을 확인하고 속성 및 결과 receipt를 저장한다.
4. `MOGRT_TEXT_WRITE_VERIFIED = false`는 유지한다. 실제 호스트 문제가 해결되었다는
   근거 없이 텍스트 적용을 켜지 않는다.
5. 향후 독립적인 호스트 쓰기 검증에서 한글·줄바꿈·이모지의 재읽기, 화면 및 되돌리기를 확인한다.

## 이번 실행 기록

- 기준 브랜치 커밋: `0617e3224c7015e05c96634ba59cb776de2583eb`.
- Node.js 22.16.0: 기능 테스트 20개 통과. 처음에는 13개 실패를 확인한 후 구현했다.
- Linux Chromium, Noto Sans CJK KR: 브라우저 검사 18개 통과. 화면 밖 자막이 나타나는
  축소 계산 오류를 재현하는 회귀 검사를 추가하고 수정했다.
- 실제 어댑터 계약 및 전체 워크스페이스 검사는 GitHub CI 결과를 별도로 확인해야 한다.
- 맥 원격 장치가 오프라인이어서 Premiere/UXP 실행과 실제 MOGRT 수정은 이번에 하지 않았다.
- 자체 코드 검토만 수행했다. 독립 리뷰어 검토와 실제 미디어/음성 싱크 검증은 미실시다.

원본 라이선스 및 검사한 Git blob 식별자는 `THIRD_PARTY_NOTICES.txt`에 있다.
