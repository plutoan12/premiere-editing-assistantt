import {
  demand,
  treeRevision,
  type BinTree,
  type BinHost,
  type BinNode,
} from "./bin-organizer.js";
interface Item {
  name: string;
  getId(): string;
  getParentBin(): Folder;
}
interface Folder {
  getItems(): Promise<Item[]>;
  createBinAction(name: string, makeUnique: boolean): unknown;
  createMoveItemAction(item: Item, parent: Folder): unknown;
  createRemoveItemAction(item: Item): unknown;
}
interface Project {
  guid: { toString(): string };
  path: string;
  getRootItem(): Promise<Folder>;
  lockedAccess(fn: () => void): void;
  executeTransaction(
    fn: (compound: { addAction(action: unknown): void }) => void,
    label: string,
  ): boolean;
}
export interface BinPremiere {
  Project: { getActiveProject(): Promise<Project | null> };
  ProjectItem: { cast(item: Folder): Item };
  ProjectUtils: {
    getSelection(project: Project): Promise<{ getItems(): Promise<Item[]> }>;
  };
  FolderItem: { cast(item: Item): Folder | null };
  ClipProjectItem: {
    cast(
      item: Item,
    ): null | {
      isSequence(): Promise<boolean>;
      isOffline(): Promise<boolean>;
      getMediaFilePath(): Promise<string>;
    };
  };
}
/** Public 26.5 APIs; every Action is constructed inside lockedAccess. */
export function createBinHost(ppro: BinPremiere, appVersion: string): BinHost {
  async function capture() {
    const project = await ppro.Project.getActiveProject();
    demand(project && project.path, "저장된 Premiere 프로젝트를 먼저 여세요.");
    const projectKey = project.guid.toString(),
      projectPath = project.path,
      root = await project.getRootItem();
    const refs = new Map<string, Item>(),
      folders = new Map<string, Folder>(),
      items: BinNode[] = [];
    const rootItem = ppro.ProjectItem.cast(root),
      rootId = rootItem.getId();
    async function visit(
      item: Item,
      parentId?: string,
      depth = 0,
    ): Promise<void> {
      demand(
        depth <= 64 && items.length < 10000,
        "프로젝트가 너무 크거나 Bin 깊이가 64를 넘습니다.",
      );
      const id = item.getId();
      demand(id && !refs.has(id), "프로젝트 항목 ID가 중복됩니다.");
      refs.set(id, item);
      let folder: Folder | null = null;
      try {
        folder = ppro.FolderItem.cast(item);
      } catch {}
      if (!parentId) folder = root;
      const node: BinNode = {
        id,
        name: item.name,
        kind: folder ? "bin" : "unsupported",
        ...(parentId ? { parentId } : {}),
      };
      items.push(node);
      if (folder) {
        folders.set(id, folder);
        for (const child of await folder.getItems())
          await visit(child, id, depth + 1);
      } else {
        let clip;
        try {
          clip = ppro.ClipProjectItem.cast(item);
        } catch {}
        if (clip && !(await clip.isSequence()) && !(await clip.isOffline())) {
          const path = await clip.getMediaFilePath();
          if (path) {
            node.kind = "clip";
            node.sourcePath = path;
          }
        }
      }
    }
    await visit(rootItem);
    const selected = await (
      await ppro.ProjectUtils.getSelection(project)
    ).getItems();
    demand(selected.length <= 500, "한 번에 500개 이하의 원본을 선택하세요.");
    const active = await ppro.Project.getActiveProject();
    demand(
      active?.guid.toString() === projectKey && active.path === projectPath,
      "프로젝트가 변경됐습니다.",
    );
    const tree: BinTree = {
      projectKey,
      projectPath,
      appVersion,
      rootId,
      selectedIds: selected.map((i) => i.getId()),
      items,
    };
    return { project, tree, refs, folders };
  }
  return {
    read: async () => (await capture()).tree,
    async transact(expected, commands) {
      const live = await capture(),
        { tree, project, refs, folders } = live;
      demand(
        treeRevision(tree) === treeRevision(expected),
        "프로젝트가 변경됐습니다. 적용안을 다시 확인하세요.",
      );
      for (const cmd of commands) {
        if (cmd.kind === "create")
          demand(
            folders.has(cmd.parentId) &&
              !tree.items.some(
                (i) => i.parentId === cmd.parentId && i.name === cmd.name,
              ),
            "Bin 이름이 충돌합니다.",
          );
        if (cmd.kind === "move")
          demand(
            tree.items.find((i) => i.id === cmd.id)?.kind === "clip" &&
              folders.has(cmd.parentId),
            "원본 클립 이동만 지원합니다.",
          );
        if (cmd.kind === "remove")
          demand(
            cmd.id !== tree.rootId &&
              folders.has(cmd.id) &&
              !tree.items.some((i) => i.parentId === cmd.id),
            "비어 있는 Bin만 정리할 수 있습니다.",
          );
      }
      let ok = false;
      project.lockedAccess(() => {
        demand(
          project.guid.toString() === tree.projectKey &&
            project.path === tree.projectPath,
          "프로젝트가 변경됐습니다.",
        );
        // Synchronous parent/name checks close the gap between async discovery and Actions.
        for (const node of tree.items) {
          const item = refs.get(node.id)!;
          demand(
            item.getId() === node.id && item.name === node.name,
            "항목이 변경됐습니다.",
          );
          if (node.parentId)
            demand(
              ppro.ProjectItem.cast(item.getParentBin()).getId() ===
                node.parentId,
              "항목 위치가 변경됐습니다.",
            );
        }
        ok = project.executeTransaction(
          (compound) => {
            for (const cmd of commands) {
              if (cmd.kind === "create")
                compound.addAction(
                  folders.get(cmd.parentId)!.createBinAction(cmd.name, false),
                );
              if (cmd.kind === "move")
                compound.addAction(
                  folders
                    .get(tree.rootId)!
                    .createMoveItemAction(
                      refs.get(cmd.id)!,
                      folders.get(cmd.parentId)!,
                    ),
                );
              if (cmd.kind === "remove") {
                const node = tree.items.find((i) => i.id === cmd.id)!;
                compound.addAction(
                  folders
                    .get(node.parentId!)!
                    .createRemoveItemAction(refs.get(cmd.id)!),
                );
              }
            }
          },
          "Media Organizer: " +
            (commands[0]?.kind === "create"
              ? "Bin 생성"
              : commands[0]?.kind === "remove"
                ? "빈 Bin 정리"
                : "클립 이동"),
        );
      });
      demand(
        ok,
        "Premiere가 변경 완료를 확인하지 않았습니다. 최근 분류 되돌리기로 확인하세요.",
      );
    },
  };
}
