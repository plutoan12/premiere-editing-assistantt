/** Narrow read-only subset reused from apps/premiere-panel's 26.5 host discovery. */
interface Item {
  name: string;
  getId(): string;
}
interface Project {
  guid: { toString(): string };
}
export interface Premiere {
  Project: { getActiveProject(): Promise<Project | null> };
  ProjectUtils: {
    getSelection(project: Project): Promise<{ getItems(): Promise<Item[]> }>;
  };
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
export async function selectedSourcePaths(ppro: Premiere) {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("Premiere 프로젝트를 먼저 여세요.");
  const projectKey = project.guid.toString(),
    selection = await ppro.ProjectUtils.getSelection(project),
    items = await selection.getItems();
  if (!projectKey || items.length > 500)
    throw new Error("Select at most 500 source files.");
  const ids = new Set<string>(),
    paths: string[] = [];
  let skipped = 0;
  for (const item of items) {
    const id = item.getId();
    if (!id || ids.has(id)) throw new Error("Ambiguous host identity");
    ids.add(id);
    let clip;
    try {
      clip = ppro.ClipProjectItem.cast(item);
    } catch {
      skipped++;
      continue;
    }
    if (!clip || (await clip.isSequence()) || (await clip.isOffline())) {
      skipped++;
      continue;
    }
    const path = await clip.getMediaFilePath();
    if (!path) {
      skipped++;
      continue;
    }
    paths.push(path);
  }
  if ((await ppro.Project.getActiveProject())?.guid.toString() !== projectKey)
    throw new Error("Active project changed during selection read");
  return { projectKey, paths: [...new Set(paths)], skipped };
}
