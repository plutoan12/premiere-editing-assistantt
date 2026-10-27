import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve("../.."),
  directory = resolve(root, "build/media-bin-host-" + Date.now());
await mkdir(directory, { recursive: true });
await build({
  entryPoints: ["tests/host/bins.ts"],
  outfile: directory + "/main.js",
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2022",
  external: ["premierepro", "uxp", "os", "fs", "./config.js"],
});
await writeFile(
  directory + "/config.js",
  "module.exports=" +
    JSON.stringify({
      projectPath: directory + "/Media Bin Acceptance.prproj",
      sourcePath: root + "/build/media-runtime-validation/sources/샘플_01.mov",
      reportPath: directory + "/report.json",
    }),
);
await writeFile(
  directory + "/manifest.json",
  JSON.stringify({
    manifestVersion: 5,
    id: "local.pea.media.bins.acceptance",
    name: "Media Bin acceptance",
    version: "0.1.0",
    main: "index.html",
    host: [{ app: "premierepro", minVersion: "26.5.0" }],
    entrypoints: [
      {
        type: "panel",
        id: "binAcceptance",
        label: { default: "Media Bin acceptance" },
        minimumSize: { width: 500, height: 500 },
      },
    ],
    requiredPermissions: { localFileSystem: "fullAccess" },
  }),
);
await writeFile(
  directory + "/index.html",
  '<!doctype html><html><body style="padding:20px"><h2>Generated media Bin acceptance</h2><button id="run">Run owned fixture</button><textarea id="report" style="width:100%;height:400px"></textarea><script src="main.js"></script></body></html>',
);
console.log(directory);
