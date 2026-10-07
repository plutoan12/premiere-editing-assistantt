import { createRequire } from "node:module";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "apps/premiere-caption-bridge");
const output = join(root, "dist/premiere-caption-bridge");
const require = createRequire(join(source, "package.json"));
const { build } = require("esbuild");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({ entryPoints: [join(source, "src/ui.ts")], outfile: join(output, "main.js"), bundle: true,
  platform: "browser", format: "iife", target: "chrome99", legalComments: "eof", logLevel: "info" });
for (const path of ["index.html", "style.css", "CSXS/manifest.xml", "host/bootstrap.jsx", "host/captions.jsx",
  "vendor/CSInterface.js", "vendor/json2.js", "vendor/Adobe-Samples-LICENSE.txt", "vendor/Adobe-SDK-License.pdf", "vendor/README.md"]) {
  await mkdir(dirname(join(output, path)), { recursive: true });
  await copyFile(join(source, path), join(output, path));
}
console.log(`Caption companion staged at ${output}; this does not sign or install the extension.`);
