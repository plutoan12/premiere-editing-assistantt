import {
  importCatalog,
  createSearchIndex,
  defaultRuleSet,
  effectiveMetadata,
  filenameFromUri,
  validDate,
  type CatalogState,
} from "@pea/media-organizer";
import { preparePreview, type PreviewRow } from "./preview.js";
import { selectedSourcePaths, type Premiere } from "./premiere.js";
declare const require: (name: string) => any;
const fs = require("uxp").storage.localFileSystem,
  ppro = require("premierepro") as Premiere;
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const status = el("status"),
  output = el<HTMLTextAreaElement>("results"),
  assetSelect = el<HTMLSelectElement>("asset");
let connection: { baseUrl: string; token: string } | undefined,
  state: CatalogState | undefined,
  busy = false;
let preview = new Map<string, PreviewRow>();
const index = createSearchIndex(),
  rules = defaultRuleSet("d476751f-1b86-46e0-b5b2-0ba7b07fa4c1");
function buttons() {
  for (const id of ["files", "selection", "refresh", "save"])
    el<HTMLButtonElement>(id).disabled = busy || !connection;
  el<HTMLButtonElement>("connect").disabled = busy;
  el<HTMLButtonElement>("cancel").disabled = !busy || !connection;
}
async function request(route: string, input?: unknown) {
  if (!connection) throw new Error("먼저 로컬 엔진에 연결하세요.");
  const response = await fetch(connection.baseUrl + route, {
    method: input === undefined ? "GET" : "POST",
    headers: {
      authorization: "Bearer " + connection.token,
      ...(input === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.message ?? body.error ?? "로컬 엔진 요청 실패");
  return body;
}
function selectedMetadata() {
  if (!state) return;
  const target = { kind: "asset" as const, id: assetSelect.value };
  if (!target.id) return;
  el<HTMLInputElement>("date").value =
    effectiveMetadata(target, state, "captureDate").value ?? "";
  el<HTMLInputElement>("device").value =
    effectiveMetadata(target, state, "deviceId").value ?? "";
}
function render() {
  if (!state) return;
  const hits = index.search({
      text: el<HTMLInputElement>("query").value,
      filters: {},
    }),
    seen = new Set<string>(),
    lines: string[] = [];
  for (const hit of hits) {
    if (seen.has(hit.mediaAssetId)) continue;
    seen.add(hit.mediaAssetId);
    const row = preview.get(hit.mediaAssetId)!;
    lines.push(
      row.filename,
      row.pathSegments.join(" / "),
      row.issues.length
        ? "확인 필요: " +
            row.issues
              .map(
                (i) =>
                  ({
                    missing: "촬영일·기기 확인",
                    metadata_unconfirmed: "촬영일 확인",
                    conflict: "촬영 정보 충돌",
                    offline: "오프라인",
                    availability_unknown: "파일 위치 확인",
                    source_unverified: "파일 재분석",
                    source_changed: "변경된 구간 확인",
                  })[i] ?? "정보 확인",
              )
              .join(", ")
        : "분류 준비됨",
      row.uri,
      "",
    );
  }
  output.value = lines.join("\n") || "검색 결과가 없습니다.";
  el("count").textContent =
    `저장된 파일 ${state.assets.length}개 · 검색 결과 ${seen.size}개 · 카탈로그 버전 ${state.revision}`;
}
async function accept(catalog: string) {
  state = importCatalog(catalog);
  await index.rebuild(state);
  preview = preparePreview(state, rules);
  const chosen = assetSelect.value;
  while (assetSelect.firstChild)
    assetSelect.removeChild(assetSelect.firstChild);
  for (const row of state.assets) {
    const option = document.createElement("option");
    option.value = row.asset.id;
    option.textContent = filenameFromUri(row.asset.uri);
    assetSelect.appendChild(option);
  }
  assetSelect.value = state.assets.some((a) => a.asset.id === chosen)
    ? chosen
    : (state.assets[0]?.asset.id ?? "");
  selectedMetadata();
  render();
}
function run(action: () => Promise<void>) {
  return async () => {
    if (busy) return;
    busy = true;
    buttons();
    try {
      await action();
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      buttons();
    }
  };
}
el("connect").addEventListener(
  "click",
  run(async () => {
    const file = await fs.getFileForOpening({ types: ["json"] });
    if (!file) return;
    const raw = JSON.parse(await file.read());
    if (
      raw.protocol !== "pea-media-v1" ||
      typeof raw.baseUrl !== "string" ||
      !/^http:\/\/localhost:[1-9]\d{0,4}$/.test(raw.baseUrl) ||
      typeof raw.token !== "string" ||
      !/^[\w-]{43}$/.test(raw.token)
    )
      throw new Error("Media Organizer 연결 파일이 아닙니다.");
    connection = { baseUrl: raw.baseUrl, token: raw.token };
    await accept((await request("/catalog")).catalog);
    status.textContent =
      "로컬 엔진 연결 완료 · 저장된 카탈로그를 복원했습니다.";
  }),
);
async function register(paths: string[]) {
  if (!paths.length) {
    status.textContent = "등록할 원본 파일이 없습니다.";
    return;
  }
  status.textContent = `${paths.length}개 파일을 읽는 중입니다…`;
  const response = await request("/ingest", { paths });
  await accept(response.catalog);
  const counts: Record<string, number> = {};
  for (const item of response.result.items)
    counts[item.state] = (counts[item.state] ?? 0) + 1;
  const labels: Record<string, string> = {
    registered: "등록",
    updated: "변경",
    unchanged: "동일",
    offline: "오프라인",
    failed: "실패",
    cancelled: "취소",
    changed_during_read: "읽는 중 변경",
    unsupported: "지원 확인 필요",
  };
  status.textContent = Object.entries(counts)
    .map(([key, count]) => (labels[key] ?? key) + " " + count + "개")
    .join(" · ");
  const errors = response.result.items
    .filter((i: any) => i.error)
    .map((i: any) => i.error.message);
  if (errors.length) status.textContent += " — " + errors.join(" / ");
}
el("files").addEventListener(
  "click",
  run(async () => {
    const files = await fs.getFileForOpening({ allowMultiple: true });
    if (!files) return;
    await register(
      (Array.isArray(files) ? files : [files]).map((f: any) => f.nativePath),
    );
  }),
);
el("selection").addEventListener(
  "click",
  run(async () => {
    const selected = await selectedSourcePaths(ppro);
    await register(selected.paths);
    if (selected.skipped)
      status.textContent += ` · 폴더·시퀀스·오프라인 ${selected.skipped}개 제외`;
  }),
);
el("refresh").addEventListener(
  "click",
  run(async () => {
    await accept((await request("/catalog")).catalog);
    status.textContent = "저장된 카탈로그를 다시 읽었습니다.";
  }),
);
el("cancel").addEventListener("click", async () => {
  try {
    await request("/cancel", {});
    status.textContent = "중지 요청을 보냈습니다. 완료된 파일은 저장됩니다.";
  } catch (e) {
    status.textContent = String(e);
  }
});
el("save").addEventListener(
  "click",
  run(async () => {
    if (!state || !assetSelect.value) return;
    const assetId = assetSelect.value,
      date = el<HTMLInputElement>("date").value.trim(),
      device = el<HTMLInputElement>("device").value.trim();
    if (date && !validDate(date))
      throw new Error("촬영일은 YYYY-MM-DD로 입력하세요.");
    for (const [field, value] of [
      ["captureDate", date],
      ["deviceId", device],
    ])
      if (value)
        await accept(
          (
            await request("/metadata", {
              assetId,
              field,
              value,
              revision: state.revision,
            })
          ).catalog,
        );
    status.textContent = "확인한 촬영일·기기를 저장했습니다.";
  }),
);
el("query").addEventListener("input", render);
assetSelect.addEventListener("change", selectedMetadata);
buttons();
