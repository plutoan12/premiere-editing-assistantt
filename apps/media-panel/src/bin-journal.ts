import { parseBinJournal, type BinJournal } from "./bin-organizer.js";
export interface JournalStorage {
  setItem(key: string, value: string): void;
  getItem(key: string): string | null;
}
const key = (project: { projectKey: string; projectPath: string }) =>
  "pea-media-bins-v1:" +
  JSON.stringify([project.projectKey, project.projectPath]);
export function createJournalStore(storage: JournalStorage) {
  return {
    async save(journal: BinJournal) {
      const id = key(journal.plan.before),
        raw = JSON.stringify(journal);
      storage.setItem(id, raw);
      if (storage.getItem(id) !== raw)
        throw Error("되돌리기 기록을 저장하지 못했습니다.");
    },
    read(project: { projectKey: string; projectPath: string }) {
      const raw = storage.getItem(key(project));
      return raw ? parseBinJournal(raw) : undefined;
    },
  };
}
