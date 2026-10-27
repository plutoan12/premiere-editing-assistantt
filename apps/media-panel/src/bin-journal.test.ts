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
async function fixture(projectPath = "/original.prproj") {
  const map = new Map<string, string>(),
    storage = {
      get length() {
        return map.size;
      },
      key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    };
  const tree: BinTree = {
    projectKey: "project",
    projectPath,
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
  return { tree, before, storage, map, host };
}
it("restores a persisted undo record in a new store and isolates project copies", async () => {
  const { tree, before, storage, host } = await fixture();
  const fresh = createJournalStore(storage);
  expect(
    fresh.read({ ...tree, projectPath: "/save-as.prproj" }),
  ).toBeUndefined();
  await undoBinPlan(fresh.read(tree)!, host, fresh.save);
  expect(tree.items).toEqual(before);
  expect(fresh.read(tree)?.status).toBe("undone");
  // Silently dropped writes must not be mistaken for a durable inverse record.
  const broken = createJournalStore({
    length: 0,
    key: () => null,
    getItem: () => null,
    setItem: () => {},
  });
  await expect(broken.save(fresh.read(tree)!)).rejects.toThrow(/저장/);
});

it.each(["NFC", "NFD", "mixed"])(
  "restores a legacy %s Mac project after its path normalization changes",
  async (form) => {
    const nfc = "/편집/카페.prproj";
    const originalPath =
      form === "mixed"
        ? "/편집/" + "카페.prproj".normalize("NFD")
        : nfc.normalize(form as "NFC" | "NFD");
    const { tree, before, storage, host, map } = await fixture(originalPath);
    const legacyRaw = [...map.values()][0];
    // The Mac host now exposes a canonical identity, even when Premiere reopens in NFD.
    tree.projectPath = nfc;
    const fresh = createJournalStore(storage, "darwin");
    expect(fresh.read({ ...tree, projectKey: "other" })).toBeUndefined();
    expect(
      fresh.read({ ...tree, projectPath: "/편집/다른.prproj" }),
    ).toBeUndefined();
    const saved = fresh.read({ ...tree, projectPath: nfc.normalize("NFD") });
    expect(saved?.status).toBe("applied");
    await undoBinPlan(saved!, host, fresh.save);
    expect(tree.items).toEqual(before);
    const reloaded = createJournalStore(storage, "darwin");
    expect(reloaded.read(tree)?.status).toBe("undone");
    expect(
      reloaded.read({ ...tree, projectPath: nfc.normalize("NFD") })?.status,
    ).toBe("undone");
    // A retained pre-migration record cannot resurface after restoration.
    expect([...map.values()]).toContain(legacyRaw);
  },
);
it("keeps Windows Unicode paths distinct", async () => {
  const { tree, storage } = await fixture("C:\\편집\\카페.prproj");
  const store = createJournalStore(storage, "win32");
  expect(store.read(tree)?.status).toBe("applied");
  expect(
    store.read({ ...tree, projectPath: tree.projectPath.normalize("NFD") }),
  ).toBeUndefined();
});
it("refuses conflicting legacy records for the same normalized Mac project", async () => {
  const { tree, storage, map } = await fixture("/편집/카페.prproj");
  const journal = JSON.parse([...map.values()][0]);
  journal.plan.before.projectPath = tree.projectPath.normalize("NFD");
  journal.status = "undoing";
  storage.setItem(
    "pea-media-bins-v1:" +
      JSON.stringify([tree.projectKey, journal.plan.before.projectPath]),
    JSON.stringify(journal),
  );
  expect(() => createJournalStore(storage, "darwin").read(tree)).toThrow(
    /충돌/,
  );
});
it("does not move clips when the migrated Mac journal cannot be persisted", async () => {
  const { tree, storage, host } = await fixture(
    "/편집/카페.prproj".normalize("NFD"),
  );
  tree.projectPath = tree.projectPath.normalize("NFC");
  const applied = structuredClone(tree);
  const store = createJournalStore(
    {
      get length() {
        return storage.length;
      },
      key: storage.key,
      getItem: storage.getItem,
      setItem: () => {},
    },
    "darwin",
  );
  await expect(
    undoBinPlan(store.read(tree)!, host, store.save),
  ).rejects.toThrow(/저장/);
  expect(tree).toEqual(applied);
  expect(createJournalStore(storage, "darwin").read(tree)?.status).toBe(
    "applied",
  );
});
