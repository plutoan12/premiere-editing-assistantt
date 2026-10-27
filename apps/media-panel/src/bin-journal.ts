import {
  demand,
  parseBinJournal,
  treeRevision,
  type BinJournal,
} from "./bin-organizer.js";
import { projectPathKey } from "./project-path.js";
export interface JournalStorage {
  readonly length: number;
  key(index: number): string | null;
  setItem(key: string, value: string): void;
  getItem(key: string): string | null;
}
type ProjectIdentity = { projectKey: string; projectPath: string };
const legacyPrefix = "pea-media-bins-v1:";
export function createJournalStore(storage: JournalStorage, platform = "") {
  const identity = (project: ProjectIdentity) =>
    JSON.stringify([
      project.projectKey,
      projectPathKey(project.projectPath, platform),
    ]);
  // A separate canonical key makes completed restores take precedence over old
  // NFC/NFD aliases, without a non-atomic rewrite of multiple localStorage keys.
  const key = (project: ProjectIdentity) =>
    (platform === "darwin" ? "pea-media-bins-v2:darwin:" : legacyPrefix) +
    identity(project);
  function parse(raw: string, project: ProjectIdentity): BinJournal {
    const journal = parseBinJournal(raw),
      before = journal.plan.before;
    demand(
      identity(before) === identity(project),
      "되돌리기 기록의 프로젝트가 일치하지 않습니다.",
    );
    if (platform === "darwin") {
      before.projectPath = projectPathKey(before.projectPath, platform);
      const context = journal.plan.hostPlan.expectedContext;
      context.hostProjectKey = identity(before);
      context.hostRevision = treeRevision(before);
    }
    return journal;
  }
  return {
    async save(journal: BinJournal) {
      const id = key(journal.plan.before),
        raw = JSON.stringify(
          parse(JSON.stringify(journal), journal.plan.before),
        );
      storage.setItem(id, raw);
      if (storage.getItem(id) !== raw)
        throw Error("되돌리기 기록을 저장하지 못했습니다.");
    },
    read(project: ProjectIdentity) {
      const raw = storage.getItem(key(project));
      if (raw !== null) return parse(raw, project);
      if (platform !== "darwin") return undefined;
      let found: BinJournal | undefined;
      for (let i = 0; i < storage.length; i++) {
        const id = storage.key(i);
        if (!id?.startsWith(legacyPrefix)) continue;
        let parts: unknown;
        try {
          parts = JSON.parse(id.slice(legacyPrefix.length));
        } catch {
          continue;
        }
        if (
          !Array.isArray(parts) ||
          parts.length !== 2 ||
          typeof parts[0] !== "string" ||
          typeof parts[1] !== "string" ||
          identity({ projectKey: parts[0], projectPath: parts[1] }) !==
            identity(project)
        )
          continue;
        const old = storage.getItem(id);
        if (old === null) continue;
        const candidate = parse(old, project);
        demand(
          !found || JSON.stringify(found) === JSON.stringify(candidate),
          "동일 프로젝트의 되돌리기 기록이 충돌합니다. 기록을 확인하세요.",
        );
        found = candidate;
      }
      return found;
    },
  };
}
