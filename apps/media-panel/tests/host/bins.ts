/** Runs only in an explicitly created, generated-media acceptance project. */
import {
  emptyCatalog,
  defaultRuleSet,
  setMetadataOverride,
} from "@pea/media-organizer";
import { createBinHost } from "../../src/bin-host.js";
import {
  applyBinPlan,
  prepareBinPlan,
  undoBinPlan,
  treeRevision,
} from "../../src/bin-organizer.js";
import { createJournalStore } from "../../src/bin-journal.js";
declare const require: (name: string) => any;
const ppro = require("premierepro"),
  platform = String(require("os").platform()),
  fs = require("fs"),
  cfg = require("./config.js"),
  out = document.getElementById("report") as HTMLTextAreaElement;
const assert = (value: unknown, msg: string) => {
  if (!value) throw Error(msg);
};
let used = false;
document.getElementById("run")!.addEventListener("click", async () => {
  if (used) return;
  used = true;
  const report: any = {
    version: require("uxp").host.version,
    projectPath: cfg.projectPath,
  };
  try {
    try {
      await fs.lstat(cfg.projectPath);
      throw Error("Fixture already exists");
    } catch (e) {
      if (String(e).includes("Fixture already exists")) throw e;
    }
    const project = await ppro.Project.createProject(cfg.projectPath);
    assert(project.path === cfg.projectPath, "Unexpected project path");
    assert(
      await project.importFiles(
        [cfg.sourcePath],
        true,
        await project.getRootItem(),
        false,
      ),
      "Import failed",
    );
    const native = createBinHost(ppro, report.version, platform),
      before = await native.read();
    const source = before.items.find((i) => i.sourcePath === cfg.sourcePath);
    assert(source, "Owned fixture source missing");
    const host = {
      ...native,
      read: async () => ({
        ...(await native.read()),
        selectedIds: [source!.id],
      }),
    };
    let state = emptyCatalog(crypto.randomUUID());
    const id = crypto.randomUUID(),
      uri = new URL(
        "file://" + cfg.sourcePath.split("/").map(encodeURIComponent).join("/"),
      ).href;
    state.assets.push({
      asset: {
        id,
        uri,
        readOnly: true,
        fingerprint: { algorithm: "sha256", value: "a".repeat(64) },
      },
      locations: [uri],
      fileRevision: 1,
      availability: "online",
      sourceState: "verified",
    });
    for (const [field, value] of [
      ["captureDate", "2026-10-13"],
      ["deviceId", "Camera A"],
      ["mediaKind", "video"],
    ] as const)
      state = setMetadataOverride(state, { kind: "asset", id }, field, value);
    const store = createJournalStore(localStorage, platform),
      rules = defaultRuleSet(crypto.randomUUID()),
      plan = prepareBinPlan(state, rules, await host.read(), () =>
        crypto.randomUUID(),
      );
    await applyBinPlan(plan, host, store.save);
    const after = await host.read(),
      moved = after.items.find((i) => i.id === source!.id)!;
    assert(moved.parentId !== source!.parentId, "Source not moved");
    assert(
      after.items.find((i) => i.id === moved.parentId)?.name === "Video",
      "Wrong destination",
    );
    report.applied = {
      moved: 1,
      createdBins: store.read(before)!.createdBins.length,
    };
    const again = prepareBinPlan(state, rules, after, () =>
      crypto.randomUUID(),
    );
    assert(again.moves.length === 0, "Repeated apply not idempotent");
    report.idempotent = true;
    await undoBinPlan(
      createJournalStore(localStorage, platform).read(before)!,
      host,
      store.save,
    );
    const restored = await host.read();
    assert(
      treeRevision(restored) === treeRevision(before),
      "Tree was not restored",
    );
    report.restored = true;
    report.sequences = (await project.getSequences()).length;
    assert(report.sequences === 0, "Unexpected timeline");
    await project.save();
    report.passed = true;
  } catch (e) {
    report.error = String(e);
  }
  out.value = JSON.stringify(report, null, 2);
  await fs.writeFile(cfg.reportPath, JSON.stringify(report, null, 2));
});
