import { expect, it } from "vitest";
import { selectedSourcePaths } from "./premiere.js";
function fixture() {
  const project = { guid: { toString: () => "project-1" } },
    items = [
      { getId: () => "a", name: "A" },
      { getId: () => "b", name: "B" },
    ];
  const module = {
    Project: { getActiveProject: async () => project },
    ProjectUtils: {
      getSelection: async () => ({ getItems: async () => items }),
    },
    ClipProjectItem: {
      cast: (item: any) => ({
        isSequence: async () => item.name === "B",
        isOffline: async () => false,
        getMediaFilePath: async () => "/tmp/" + item.name + ".mov",
      }),
    },
  };
  return { module, project };
}
it("reads only original online source paths with stable project identity", async () => {
  const { module } = fixture();
  expect(await selectedSourcePaths(module)).toEqual({
    projectKey: "project-1",
    paths: ["/tmp/A.mov"],
    skipped: 1,
  });
});
it("rejects a project switch during selection read", async () => {
  const { module, project } = fixture();
  let call = 0;
  module.Project.getActiveProject = async () =>
    ++call === 1 ? project : { guid: { toString: () => "other" } };
  await expect(selectedSourcePaths(module)).rejects.toThrow(/project changed/i);
});
it("does not silently accept duplicate host identities", async () => {
  const { module } = fixture();
  module.ProjectUtils.getSelection = async () => ({
    getItems: async () => [
      { name: "A", getId: () => "a" },
      { name: "A", getId: () => "a" },
    ],
  });
  await expect(selectedSourcePaths(module)).rejects.toThrow(/identity/);
});
