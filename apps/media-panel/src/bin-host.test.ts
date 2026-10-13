import { expect, it } from "vitest";
import * as native from "./bin-host.js";
function fixture() {
  let locked = false,
    seq = 0,
    reject = false;
  const nodes: any[] = [];
  const make = (
    id: string,
    name: string,
    parent: any,
    bin: boolean,
    path?: string,
  ) => {
    const item: any = {
      name,
      getId: () => id,
      getParentBin: () => item.parent,
      parent,
      bin,
      getItems: async () => nodes.filter((n) => n.parent === item),
      isSequence: async () => false,
      isOffline: async () => false,
      getMediaFilePath: async () => path,
      createBinAction: (name: string) => {
        expect(locked).toBe(true);
        return () => make(`new-${++seq}`, name, item, true);
      },
      createMoveItemAction: (moved: any, dest: any) => {
        expect(locked).toBe(true);
        return () => {
          moved.parent = dest;
        };
      },
      createRemoveItemAction: (removed: any) => {
        expect(locked).toBe(true);
        return () => {
          nodes.splice(nodes.indexOf(removed), 1);
        };
      },
    };
    nodes.push(item);
    return item;
  };
  const root = make("root", "Root", null, true),
    source = make("clip", "A.mov", root, false, "/a.mov");
  const project = {
    guid: { toString: () => "p1" },
    path: "/p.prproj",
    getRootItem: async () => root,
    lockedAccess: (fn: () => void) => {
      locked = true;
      try {
        fn();
      } finally {
        locked = false;
      }
    },
    executeTransaction: (fn: any, label: string) => {
      expect(locked).toBe(true);
      expect(label).toContain("Media Organizer");
      const actions: any[] = [];
      fn({ addAction: (a: any) => actions.push(a) });
      if (reject) return false;
      actions.forEach((a) => a());
      return true;
    },
  };
  const ppro: any = {
    Project: { getActiveProject: async () => project },
    ProjectUtils: {
      getSelection: async () => ({ getItems: async () => [source] }),
    },
    ProjectItem: { cast: (i: any) => i },
    FolderItem: { cast: (i: any) => (i.bin ? i : null) },
    ClipProjectItem: { cast: (i: any) => (i.bin ? null : i) },
  };
  return {
    ppro,
    nodes,
    project,
    host: () => native.createBinHost(ppro, "26.5.2"),
    reject: () => {
      reject = true;
    },
  };
}
it("uses locked native actions, reads their results and never changes source paths", async () => {
  const f = fixture(),
    host = f.host();
  let tree = await host.read();
  await host.transact(tree, [
    { kind: "create", parentId: "root", name: "Destination" },
  ]);
  tree = await host.read();
  await host.transact(tree, [{ kind: "move", id: "clip", parentId: "new-1" }]);
  tree = await host.read();
  expect(tree.items.find((i) => i.id === "clip")).toMatchObject({
    parentId: "new-1",
    sourcePath: "/a.mov",
  });
  await expect(
    host.transact(tree, [{ kind: "remove", id: "new-1" }]),
  ).rejects.toThrow(/비어|empty/i);
  await host.transact(tree, [{ kind: "move", id: "clip", parentId: "root" }]);
  tree = await host.read();
  await host.transact(tree, [{ kind: "remove", id: "new-1" }]);
  expect((await host.read()).items.map((i) => i.id)).toEqual(["root", "clip"]);
});
it("rejects stale context and an unconfirmed native transaction", async () => {
  const f = fixture(),
    host = f.host(),
    tree = await host.read();
  f.nodes[1].name = "Edited";
  await expect(
    host.transact(tree, [{ kind: "create", parentId: "root", name: "Wrong" }]),
  ).rejects.toThrow(/변경/);
  f.reject();
  await expect(
    host.transact(await host.read(), [
      { kind: "create", parentId: "root", name: "Failed" },
    ]),
  ).rejects.toThrow(/확인/);
  expect(f.nodes).toHaveLength(2);
});
