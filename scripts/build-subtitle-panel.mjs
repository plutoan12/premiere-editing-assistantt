import { createRequire } from "node:module";
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "apps/subtitle-panel");
const output = join(root, "dist/premiere-subtitle");
const require = createRequire(join(source, "package.json"));
const { build } = require("esbuild");

await mkdir(output, { recursive: true });
await build({
  entryPoints: [join(source, "src/ui.ts")],
  outfile: join(output, "main.js"),
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2022",
  external: ["uxp", "premierepro"],
  sourcemap: true,
  legalComments: "eof",
  logLevel: "info"
});
await Promise.all(["index.html", "style.css", "manifest.json"].map(name => copyFile(join(source, name), join(output, name))));
console.log(`Subtitle developer panel staged at ${output}`);
