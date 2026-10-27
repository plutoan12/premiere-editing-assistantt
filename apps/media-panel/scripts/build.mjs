// Same UXP build boundary as the repository's Sync panel.
import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const directory = fileURLToPath(new URL("../", import.meta.url)),
  out = resolve(directory, "../../dist/media-organizer");
await mkdir(out, { recursive: true });
await build({
  entryPoints: [resolve(directory, "src/main.ts")],
  outfile: resolve(out, "main.js"),
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2022",
  external: ["premierepro", "uxp", "os"],
  sourcemap: true,
});
for (const file of ["index.html", "manifest.json"])
  await copyFile(resolve(directory, file), resolve(out, file));
console.log("Media Organizer development panel: " + out);
