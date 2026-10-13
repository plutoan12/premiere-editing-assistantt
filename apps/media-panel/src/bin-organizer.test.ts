import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  emptyCatalog,
  defaultRuleSet,
  setMetadataOverride,
} from "@pea/media-organizer";
import * as organizer from "./bin-organizer.js";
import type {
  BinHost,
  BinTree,
  BinCommand,
  BinJournal,
} from "./bin-organizer.js";

function fixture() {
  const tree: BinTree = {
    projectKey: "p1",
    projectPath: "/project.prproj",
    appVersion: "26.5.2",
    rootId: "root",
    selectedIds: ["clip"],
    items: [
      { id: "root", name: "Root", kind: "bin" },
      { id: "original", parentId: "root", name: "Original", kind: "bin" },
      {
        id: "clip",
        parentId: "original",
        name: "A.mov",
        kind: "clip",
        sourcePath: "/source/A.mov",
      },
      {
        id: "other",
        parentId: "original",
        name: "Untouched.mov",
        kind: "clip",
        sourcePath: "/source/other.mov",
      },
    ],
  };
  let state = emptyCatalog(randomUUID());
  const assetId = randomUUID();
  state.assets.push({
    asset: {
      id: assetId,
      uri: "file:///source/A.mov",
      readOnly: true,
      fingerprint: { algorithm: "sha256", value: "a".repeat(64) },
    },
    fileRevision: 1,
    locations: ["file:///source/A.mov"],
    availability: "online",
    sourceState: "verified",
  });
  for (const [field, value] of [
    ["captureDate", "2026-10-13"],
    ["deviceId", "Camera A"],
    ["mediaKind", "video"],
  ] as const)
    state = setMetadataOverride(
      state,
      { kind: "asset", id: assetId },
      field,
      value,
    );
  let sequence = 0,
    calls = 0,
    failAt = 0,
    journal: BinJournal | undefined;
  const host: BinHost = {
    read: async () => structuredClone(tree),
    async transact(expected, commands) {
      expect(tree).toEqual(expected);
      if (++calls === failAt) throw Error("host failure");
      for (const cmd of commands) {
        if (cmd.kind === "create")
          tree.items.push({
            id: `new-${++sequence}`,
            parentId: cmd.parentId,
            name: cmd.name,
            kind: "bin",
          });
        if (cmd.kind === "move")
          tree.items.find((i) => i.id === cmd.id)!.parentId = cmd.parentId;
        if (cmd.kind === "remove") {
          if (tree.items.some((i) => i.parentId === cmd.id))
            throw Error("Not empty");
          tree.items = tree.items.filter((i) => i.id !== cmd.id);
        }
      }
    },
  };
  const save = async (j: BinJournal) => {
    journal = structuredClone(j);
  };
  const prepare = () =>
    organizer.prepareBinPlan(
      state,
      defaultRuleSet(randomUUID()),
      tree,
      randomUUID,
    );
  return {
    tree,
    host,
    state,
    prepare,
    save,
    get journal() {
      return journal!;
    },
    get calls() {
      return calls;
    },
    failAt(n: number) {
      failAt = n;
    },
  };
}
it("moves only reviewed items, reuses bins and restores original locations after journal reload", async () => {
  const f = fixture(),
    before = structuredClone(f.tree.items);
  f.tree.items.push({
    id: "existing",
    name: "Media Organizer",
    parentId: "root",
    kind: "bin",
  });
  const plan = f.prepare();
  await organizer.applyBinPlan(plan, f.host, f.save);
  expect(f.journal.status).toBe("applied");
  const clip = f.tree.items.find((i) => i.id === "clip")!;
  expect(f.tree.items.find((i) => i.id === clip.parentId)?.name).toBe("Video");
  expect(f.tree.items.find((i) => i.id === "other")?.parentId).toBe("original");
  await organizer.undoBinPlan(
    organizer.parseBinJournal(JSON.stringify(f.journal)),
    f.host,
    f.save,
  );
  expect(f.tree.items).toEqual([
    ...before,
    { id: "existing", name: "Media Organizer", parentId: "root", kind: "bin" },
  ]);
  expect(f.journal.status).toBe("undone");
});
it("blocks unconfirmed classification and unsupported selected items before writing", () => {
  const f = fixture();
  f.state.assets[0].sourceState = "unverified";
  expect(() => f.prepare()).toThrow(/확인|verify|unverified/i);
  f.state.assets[0].sourceState = "verified";
  f.tree.selectedIds = ["original"];
  expect(() => f.prepare()).toThrow(/원본|source|clip/i);
});
it("rejects ambiguous destination bins rather than choosing the first", () => {
  const f = fixture();
  f.tree.items.push(
    ...["x", "y"].map((id) => ({
      id,
      name: "Media Organizer",
      parentId: "root",
      kind: "bin" as const,
    })),
  );
  expect(() => f.prepare()).toThrow(/중복|ambiguous/i);
});
it("blocks changed project, tree and source between preview and apply", async () => {
  for (const mutate of [
    (t: BinTree) => {
      t.projectKey = "other";
    },
    (t: BinTree) => {
      t.projectPath = "/save-as.prproj";
    },
    (t: BinTree) => {
      t.items[2].parentId = "root";
    },
    (t: BinTree) => {
      t.items[2].sourcePath = "/replacement.mov";
    },
  ]) {
    const f = fixture(),
      plan = f.prepare();
    mutate(f.tree);
    await expect(
      organizer.applyBinPlan(plan, f.host, f.save),
    ).rejects.toThrow();
    expect(f.calls).toBe(0);
  }
});
it("refuses a write when the undo journal cannot be persisted", async () => {
  const f = fixture();
  await expect(
    organizer.applyBinPlan(f.prepare(), f.host, async () => {
      throw Error("disk full");
    }),
  ).rejects.toThrow(/disk full/);
  expect(f.calls).toBe(0);
});
it("can undo a partial apply and does not roll back unrelated host history", async () => {
  const f = fixture();
  f.failAt(3);
  await expect(
    organizer.applyBinPlan(f.prepare(), f.host, f.save),
  ).rejects.toThrow(/host failure/);
  expect(f.journal.status).toBe("applying");
  f.tree.items.push({
    id: "user",
    parentId: "original",
    name: "User bin",
    kind: "bin",
  });
  await organizer.undoBinPlan(f.journal, f.host, f.save);
  expect(f.tree.items.map((i) => i.id)).toEqual([
    "root",
    "original",
    "clip",
    "other",
    "user",
  ]);
});
it("blocks undo when a moved clip or its original bin was edited", async () => {
  for (const mutate of [
    (t: BinTree) => {
      t.items.find((i) => i.id === "clip")!.parentId = "root";
    },
    (t: BinTree) => {
      t.items.find((i) => i.id === "original")!.name = "Renamed";
    },
  ]) {
    const f = fixture();
    await organizer.applyBinPlan(f.prepare(), f.host, f.save);
    mutate(f.tree);
    const calls = f.calls;
    await expect(
      organizer.undoBinPlan(f.journal, f.host, f.save),
    ).rejects.toThrow(/변경|conflict/i);
    expect(f.calls).toBe(calls);
  }
});
it("preserves a created bin that now contains a user item", async () => {
  const f = fixture();
  await organizer.applyBinPlan(f.prepare(), f.host, f.save);
  const destination = f.tree.items.find((i) => i.id === "clip")!.parentId;
  f.tree.items.push({
    id: "new-user-item",
    parentId: destination,
    name: "User",
    kind: "clip",
    sourcePath: "/user.mov",
  });
  const result = await organizer.undoBinPlan(f.journal, f.host, f.save);
  expect(f.tree.items.find((i) => i.id === "clip")?.parentId).toBe("original");
  expect(f.tree.items.some((i) => i.id === destination)).toBe(true);
  expect(result.retainedBins.length).toBeGreaterThan(0);
});
it("repeated apply produces no moves or duplicate bins", async () => {
  const f = fixture();
  await organizer.applyBinPlan(f.prepare(), f.host, f.save);
  const calls = f.calls;
  const result = await organizer.applyBinPlan(f.prepare(), f.host, f.save);
  expect(result.moves).toHaveLength(0);
  expect(f.calls).toBe(calls);
});
it("recognizes native undo without moving clips twice and rejects corrupt journals", async () => {
  const f = fixture(),
    before = structuredClone(f.tree.items);
  await organizer.applyBinPlan(f.prepare(), f.host, f.save);
  f.tree.items = before;
  await organizer.undoBinPlan(f.journal, f.host, f.save);
  expect(f.journal.status).toBe("undone");
  expect(() => organizer.parseBinJournal('{"version":99}')).toThrow();
});
it("compares host snapshots independently of object property order", async () => {
  const f = fixture(),
    plan = f.prepare();
  f.tree.items = f.tree.items.map((i) => ({
    name: i.name,
    kind: i.kind,
    id: i.id,
    ...(i.parentId ? { parentId: i.parentId } : {}),
    ...(i.sourcePath ? { sourcePath: i.sourcePath } : {}),
  }));
  expect(organizer.treeRevision(f.tree)).toBe(
    organizer.treeRevision(plan.before),
  );
  await organizer.applyBinPlan(plan, f.host, f.save);
  expect(f.journal.status).toBe("applied");
});
it("rejects plans that would exceed the host read limit before creating any bins", () => {
  const f = fixture();
  for (let n = f.tree.items.length; n < 9998; n++)
    f.tree.items.push({
      id: `existing-${n}`,
      name: `Existing ${n}`,
      parentId: "root",
      kind: "bin",
    });
  expect(() => f.prepare()).toThrow(/10,000|10000|한도/);
  expect(f.calls).toBe(0);
});
it("restores both applied and unapplied items after a partial host move failure", async () => {
  const f = fixture();
  f.tree.items.push({ ...f.tree.items[2], id: "copy" });
  f.tree.selectedIds.push("copy");
  const transact = f.host.transact.bind(f.host);
  let failed = false;
  f.host.transact = async (expected, commands) => {
    if (!failed && commands[0]?.kind === "move") {
      failed = true;
      await transact(expected, [commands[0]]);
      throw Error("partial host move");
    }
    await transact(expected, commands);
  };
  await expect(
    organizer.applyBinPlan(f.prepare(), f.host, f.save),
  ).rejects.toThrow(/partial/);
  await organizer.undoBinPlan(f.journal, f.host, f.save);
  expect(
    f.tree.items
      .filter((i) => i.id === "clip" || i.id === "copy")
      .map((i) => i.parentId),
  ).toEqual(["original", "original"]);
  expect(f.tree.items.some((i) => i.id.startsWith("new-"))).toBe(false);
});
