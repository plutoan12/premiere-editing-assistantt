import { expect, it } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
it("bundles the engine for a browser without host, Node, decoder or database imports", async () => {
  const output = await build({
    entryPoints: [fileURLToPath(new URL("./index.ts", import.meta.url))],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    write: false,
    metafile: true,
    logLevel: "silent",
    plugins: [
      {
        name: "portable-engine",
        setup(builder) {
          builder.onResolve(
            { filter: /^(node:|premierepro$|uxp$|better-sqlite3$|ffmpeg$)/ },
            (args) => ({
              errors: [{ text: `forbidden engine dependency: ${args.path}` }],
            }),
          );
        },
      },
    ],
  });
  expect(output.outputFiles[0].contents.length).toBeGreaterThan(0);
  expect(
    Object.values(output.metafile!.outputs).flatMap((x) => x.imports),
  ).toEqual([]);
});
