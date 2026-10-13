import { z } from "zod";
import {
  buildOrganizationPlan,
  preflight,
  HostApplyPlanSchema,
  type HostContext,
  type HostApplyPlan,
  type CatalogState,
  type RuleSet,
  type IdFactory,
} from "@pea/media-organizer";
const text = z.string().min(1);
const nodeSchema = z
  .object({
    id: text,
    parentId: text.optional(),
    name: z.string(),
    kind: z.enum(["bin", "clip", "unsupported"]),
    sourcePath: text.optional(),
  })
  .strict();
const treeSchema = z
  .object({
    projectKey: text,
    projectPath: text,
    appVersion: text,
    rootId: text,
    selectedIds: z.array(text).max(500),
    items: z.array(nodeSchema).max(10000),
  })
  .strict();
export type BinNode = z.infer<typeof nodeSchema>;
export type BinTree = z.infer<typeof treeSchema>;
export type BinCommand =
  | { kind: "create"; parentId: string; name: string }
  | { kind: "move"; id: string; parentId: string }
  | { kind: "remove"; id: string };
export interface BinHost {
  read(): Promise<BinTree>;
  transact(expected: BinTree, commands: BinCommand[]): Promise<void>;
}
const moveSchema = z
  .object({
    before: nodeSchema,
    assetId: z.uuid(),
    pathSegments: z.array(text).min(1).max(16),
    destinationId: text.optional(),
  })
  .strict();
const planSchema = z
  .object({
    before: treeSchema,
    hostPlan: HostApplyPlanSchema,
    moves: z.array(moveSchema).max(500),
  })
  .strict();
export type BinPlan = z.infer<typeof planSchema>;
const journalSchema = z
  .object({
    version: z.literal(1),
    status: z.enum(["applying", "applied", "undoing", "undone"]),
    plan: planSchema,
    moves: z.array(moveSchema).max(500),
    createdBins: z.array(nodeSchema).max(8000),
    retainedBins: z.array(text),
    pendingCreate: z.object({ parentId: text, name: text }).strict().optional(),
  })
  .strict();
export type BinJournal = z.infer<typeof journalSchema>;
export type SaveJournal = (journal: BinJournal) => Promise<void>;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function demand(condition: unknown, message: string): asserts condition {
  if (!condition) throw Error(message);
}
export function parseBinJournal(raw: string): BinJournal {
  return journalSchema.parse(JSON.parse(raw));
}
export function treeRevision(tree: BinTree): string {
  return JSON.stringify([
    tree.projectKey,
    tree.projectPath,
    tree.appVersion,
    tree.rootId,
    [...tree.items]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((i) => [
        i.id,
        i.parentId ?? null,
        i.name,
        i.kind,
        i.sourcePath ?? null,
      ]),
  ]);
}
function validateTree(input: BinTree): BinTree {
  const tree = treeSchema.parse(input),
    ids = new Set(tree.items.map((i) => i.id));
  demand(
    ids.size === tree.items.length &&
      tree.items.find((i) => i.id === tree.rootId)?.kind === "bin",
    "프로젝트 항목 ID를 확인할 수 없습니다.",
  );
  for (const node of tree.items) {
    if (node.id === tree.rootId) {
      demand(!node.parentId, "Invalid root");
      continue;
    }
    const chain = new Set([node.id]);
    let parent = node.parentId;
    while (parent) {
      demand(!chain.has(parent), "Invalid bin cycle");
      chain.add(parent);
      const item = tree.items.find((i) => i.id === parent);
      demand(item?.kind === "bin", "Missing parent bin");
      parent = item.parentId;
    }
    demand(chain.has(tree.rootId), "Disconnected item");
  }
  return tree;
}
function context(tree: BinTree, revision: number): HostContext {
  return {
    adapterId: "premiere-bins-v1",
    hostProjectKey: JSON.stringify([tree.projectKey, tree.projectPath]),
    hostRevision: treeRevision(tree),
    catalogRevision: revision,
    capabilities: {
      editor: "premiere",
      appVersion: tree.appVersion,
      os: "host",
      adapterVersion: "1",
      revision: "bins-v1",
      features: {
        hierarchy: { status: "supported", reason: "Bin actions" },
        undo: { status: "supported", reason: "Guarded inverse moves" },
        tags: { status: "unsupported", reason: "Catalog only" },
        import: { status: "unsupported", reason: "Existing items only" },
        projectFields: { status: "unsupported", reason: "Catalog only" },
        reveal: { status: "unsupported", reason: "Not implemented" },
        rangeReveal: { status: "unsupported", reason: "Not implemented" },
      },
    },
    bindings: [],
    items: tree.items.map((i) => ({
      hostItemId: i.id,
      itemRevision: JSON.stringify(i),
      kind: i.kind,
      parentItemId: i.parentId,
      metadata: [],
    })),
  };
}
/** Match a registered location exactly; never equate files by basename. */
export function localPath(uri: string): string {
  const u = new URL(uri);
  demand(
    u.protocol === "file:" && !u.host && !u.search && !u.hash,
    "로컬 원본 경로가 필요합니다.",
  );
  const decoded = decodeURIComponent(u.pathname);
  return /^\/[A-Za-z]:\//.test(decoded)
    ? decoded.slice(1).replaceAll("/", "\\")
    : decoded;
}
function destination(tree: BinTree, segments: string[]): BinNode | undefined {
  let parent = tree.rootId;
  for (const name of segments) {
    demand(name.trim() && !/[\x00-\x1f]/.test(name), "Invalid bin name");
    const matches = tree.items.filter(
      (i) => i.parentId === parent && i.name === name,
    );
    demand(
      matches.length <= 1 && (!matches.length || matches[0].kind === "bin"),
      `중복 또는 충돌한 Bin: ${name}`,
    );
    if (!matches.length) return undefined;
    parent = matches[0].id;
  }
  return tree.items.find((i) => i.id === parent);
}
export function prepareBinPlan(
  state: CatalogState,
  rules: RuleSet,
  input: BinTree,
  ids: IdFactory,
): BinPlan {
  const tree = validateTree(input);
  demand(
    tree.selectedIds.length > 0 &&
      new Set(tree.selectedIds).size === tree.selectedIds.length,
    "프로젝트 패널에서 원본 클립을 선택하세요.",
  );
  const selected = tree.selectedIds.map((id) => {
    const item = tree.items.find((i) => i.id === id);
    demand(
      item?.kind === "clip" && item.sourcePath && item.parentId,
      "온라인 원본 클립만 선택하세요. Bin·시퀀스는 지원하지 않습니다.",
    );
    const matches = state.assets.filter((a) =>
      a.locations.some((u) => localPath(u) === item.sourcePath),
    );
    demand(
      matches.length === 1,
      `${item.name}: 원본을 등록하거나 다시 분석하세요.`,
    );
    return { item, assetId: matches[0].asset.id };
  });
  const organization = buildOrganizationPlan(
    state,
    selected.map((s) => ({ kind: "asset", id: s.assetId })),
    rules,
    [],
    ids,
  );
  demand(
    !organization.issues.length,
    "선택한 파일의 촬영일·기기·원본 상태를 확인하세요: " +
      organization.issues.map((i) => i.code).join(", "),
  );
  const moves = selected
    .map(({ item, assetId }) => {
      const assignment = organization.assignments.find(
        (a) => a.target.id === assetId,
      )!;
      const dest = destination(tree, assignment.pathSegments);
      return {
        before: copy(item),
        assetId,
        pathSegments: assignment.pathSegments,
        ...(dest ? { destinationId: dest.id } : {}),
      };
    })
    .filter((m) => m.destinationId !== m.before.parentId);
  const hostPlan: HostApplyPlan = {
    id: ids(),
    organizationPlanId: organization.id,
    adapterSchemaVersion: "premiere-bins-v1",
    expectedContext: context(tree, state.revision),
    compatibilityReport: [],
    operations: moves.map((m) => ({
      id: ids(),
      target: { kind: "asset", id: m.assetId },
      dependsOn: [],
      requiredCapabilities: ["hierarchy", "undo"],
      action: {
        kind: "move",
        itemId: m.before.id,
        pathSegments: m.pathSegments,
      },
    })),
  };
  return planSchema.parse({ before: tree, hostPlan, moves });
}
function sameProject(a: BinTree, b: BinTree) {
  demand(
    a.projectKey === b.projectKey &&
      a.projectPath === b.projectPath &&
      a.rootId === b.rootId &&
      a.appVersion === b.appVersion,
    "프로젝트 또는 앱이 변경됐습니다. 원래 프로젝트에서 다시 확인하세요.",
  );
}
async function pinned(host: BinHost, expected: BinTree) {
  const tree = validateTree(await host.read());
  demand(
    treeRevision(tree) === treeRevision(expected),
    "프로젝트 항목이 변경됐습니다. 적용안을 다시 확인하세요.",
  );
  return tree;
}
export async function applyBinPlan(
  raw: BinPlan,
  host: BinHost,
  save: SaveJournal,
): Promise<BinJournal> {
  const plan = planSchema.parse(raw);
  let tree = validateTree(await host.read());
  const check = preflight(
    plan.hostPlan,
    context(tree, plan.hostPlan.expectedContext.catalogRevision),
  );
  demand(
    check.ok,
    "프로젝트가 변경됐습니다. 적용안을 다시 확인하세요: " +
      check.reasons.join(", "),
  );
  const journal: BinJournal = {
    version: 1,
    status: "applying",
    plan: copy(plan),
    moves: copy(plan.moves),
    createdBins: [],
    retainedBins: [],
  };
  if (!journal.moves.length) return { ...journal, status: "applied" };
  await save(copy(journal));
  for (const move of journal.moves) {
    let parent = tree.rootId;
    for (const name of move.pathSegments) {
      const existing = tree.items.filter(
        (i) => i.parentId === parent && i.name === name,
      );
      demand(
        existing.length <= 1 &&
          (!existing.length || existing[0].kind === "bin"),
        "중복 Bin이 발견됐습니다.",
      );
      if (existing.length) {
        parent = existing[0].id;
        continue;
      }
      journal.pendingCreate = { parentId: parent, name };
      await save(copy(journal));
      tree = await pinned(host, tree);
      await host.transact(tree, [{ kind: "create", parentId: parent, name }]);
      const after = validateTree(await host.read());
      sameProject(tree, after);
      const added = after.items.filter(
        (i) => !tree.items.some((b) => b.id === i.id),
      );
      demand(
        added.length === 1 &&
          added[0].kind === "bin" &&
          added[0].name === name &&
          added[0].parentId === parent,
        "Bin 생성 결과를 확인할 수 없습니다. 기록되지 않은 Bin은 보존됩니다.",
      );
      const expected = { ...tree, items: [...tree.items, added[0]] };
      demand(
        treeRevision(after) === treeRevision(expected),
        "Bin 생성 중 프로젝트가 변경됐습니다.",
      );
      journal.createdBins.push(copy(added[0]));
      delete journal.pendingCreate;
      await save(copy(journal));
      tree = after;
      parent = added[0].id;
    }
    move.destinationId = parent;
  }
  await save(copy(journal)); // all inverse positions and destination IDs precede moves
  tree = await pinned(host, tree);
  await host.transact(
    tree,
    journal.moves.map((m) => ({
      kind: "move",
      id: m.before.id,
      parentId: m.destinationId!,
    })),
  );
  const after = validateTree(await host.read());
  sameProject(tree, after);
  for (const m of journal.moves)
    demand(
      after.items.find((i) => i.id === m.before.id)?.parentId ===
        m.destinationId,
      "이동 결과 확인 실패. 최근 분류 되돌리기로 복구하세요.",
    );
  journal.status = "applied";
  await save(copy(journal));
  return journal;
}
export async function undoBinPlan(
  raw: BinJournal,
  host: BinHost,
  save: SaveJournal,
): Promise<BinJournal> {
  const journal = journalSchema.parse(raw);
  demand(journal.status !== "undone", "이미 되돌린 작업입니다.");
  let tree = validateTree(await host.read());
  sameProject(journal.plan.before, tree);
  const commands: BinCommand[] = [];
  for (const m of journal.moves) {
    const current = tree.items.find((i) => i.id === m.before.id),
      original = journal.plan.before.items.find(
        (i) => i.id === m.before.parentId,
      ),
      parent = tree.items.find((i) => i.id === m.before.parentId);
    demand(
      current &&
        original &&
        parent &&
        JSON.stringify(parent) === JSON.stringify(original),
      "원래 Bin이 변경되거나 삭제됐습니다. 충돌을 확인하세요.",
    );
    demand(
      current.name === m.before.name &&
        current.kind === m.before.kind &&
        current.sourcePath === m.before.sourcePath,
      "원본 항목이 변경됐습니다. 충돌을 확인하세요.",
    );
    if (current.parentId === m.before.parentId) continue; // native Undo / interrupted inverse already restored it
    demand(
      m.destinationId && current.parentId === m.destinationId,
      "클립 위치가 변경됐습니다. 충돌을 확인하세요.",
    );
    commands.push({
      kind: "move",
      id: current.id,
      parentId: m.before.parentId!,
    });
  }
  journal.status = "undoing";
  await save(copy(journal));
  tree = await pinned(host, tree);
  if (commands.length) {
    await host.transact(tree, commands);
    tree = validateTree(await host.read());
    sameProject(journal.plan.before, tree);
  }
  for (const m of journal.moves)
    demand(
      tree.items.find((i) => i.id === m.before.id)?.parentId ===
        m.before.parentId,
      "원래 위치 복원 확인 실패. 다시 되돌리기를 실행하세요.",
    );
  journal.retainedBins = [];
  for (const created of [...journal.createdBins].reverse()) {
    const live = tree.items.find((i) => i.id === created.id);
    if (!live) continue;
    if (
      JSON.stringify(live) !== JSON.stringify(created) ||
      tree.items.some((i) => i.parentId === created.id)
    ) {
      journal.retainedBins.push(created.name);
      continue;
    }
    tree = await pinned(host, tree);
    await host.transact(tree, [{ kind: "remove", id: created.id }]);
    tree = validateTree(await host.read());
    sameProject(journal.plan.before, tree);
    demand(
      !tree.items.some((i) => i.id === created.id),
      "빈 Bin 정리 확인 실패. 다시 되돌리기를 실행하세요.",
    );
  }
  if (journal.pendingCreate)
    journal.retainedBins.push(
      journal.pendingCreate.name + " (생성 결과 미확인)",
    );
  journal.status = "undone";
  await save(copy(journal));
  return journal;
}
