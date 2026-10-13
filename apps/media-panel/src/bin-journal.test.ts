import { expect, it } from "vitest";
import { createJournalStore } from "./bin-journal.js";
import {
  prepareBinPlan,
  applyBinPlan,
  undoBinPlan,
  type BinHost,
  type BinTree,
} from "./bin-organizer.js";
import {
  emptyCatalog,
  defaultRuleSet,
  setMetadataOverride,
} from "@pea/media-organizer";
import { randomUUID } from "node:crypto";
it("restores a persisted undo record in a new store and isolates project copies", async () => {
  const map = new Map<string, string>(),
    storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    };
  const tree: BinTree = {
    projectKey: "project",
    projectPath: "/original.prproj",
    appVersion: "26.5.2",
    rootId: "root",
    selectedIds: ["clip"],
    items: [
      { id: "root", name: "Root", kind: "bin" },
      {
        id: "clip",
        parentId: "root",
        name: "a.mov",
        kind: "clip",
        sourcePath: "/a.mov",
      },
    ],
  };
  const before = structuredClone(tree.items);
  let state = emptyCatalog(randomUUID());
  const id = randomUUID();
  state.assets.push({
    asset: {
      id,
      uri: "file:///a.mov",
      readOnly: true,
      fingerprint: { algorithm: "sha256", value: "a".repeat(64) },
    },
    locations: ["file:///a.mov"],
    fileRevision: 1,
    availability: "online",
    sourceState: "verified",
  });
  state = setMetadataOverride(
    state,
    { kind: "asset", id },
    "mediaKind",
    "video",
  );
  const rules = defaultRuleSet(randomUUID());
  rules.orderedFields = ["mediaKind"];
  let count = 0;
  const host: BinHost = {
    read: async () => structuredClone(tree),
    transact: async (_expected, cmds) => {
      for (const c of cmds) {
        if (c.kind === "create")
          tree.items.push({
            id: `bin-${++count}`,
            parentId: c.parentId,
            name: c.name,
            kind: "bin",
          });
        if (c.kind === "move")
          tree.items.find((i) => i.id === c.id)!.parentId = c.parentId;
        if (c.kind === "remove")
          tree.items = tree.items.filter((i) => i.id !== c.id);
      }
    },
  };
  const first = createJournalStore(storage);
  await applyBinPlan(
    prepareBinPlan(state, rules, tree, randomUUID),
    host,
    first.save,
  );
  const fresh = createJournalStore(storage);
  expect(
    fresh.read({ ...tree, projectPath: "/save-as.prproj" }),
  ).toBeUndefined();
  await undoBinPlan(fresh.read(tree)!, host, fresh.save);
  expect(tree.items).toEqual(before);
  expect(fresh.read(tree)?.status).toBe("undone");
  // Silently dropped writes must not be mistaken for a durable inverse record.
  const broken = createJournalStore({ getItem: () => null, setItem: () => {} });
  await expect(broken.save(fresh.read(tree)!)).rejects.toThrow(/저장/);
});
