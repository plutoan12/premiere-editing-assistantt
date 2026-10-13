import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { createProbe } from "./providers.js";
import { createMediaServer } from "./server.js";
const stateDir = resolve(
  process.env.PEA_MEDIA_STATE_DIR ?? join(homedir(), ".pea", "media-organizer"),
);
const ffprobe = process.env.PEA_FFPROBE_PATH ?? "ffprobe";
const { probe, version } = await createProbe(ffprobe);
await mkdir(stateDir, { recursive: true, mode: 0o700 });
// A live helper owns this directory. A stale connection is explicit, never overwritten.
const connectionPath = join(stateDir, "connection.json");
const reservation = await import("node:fs/promises").then((fs) =>
  fs.open(connectionPath, "wx", 0o600),
);
let helper: Awaited<ReturnType<typeof createMediaServer>> | undefined;
let connection = "";
try {
  helper = await createMediaServer({
    catalogPath: join(stateDir, "catalog.sqlite"),
    probe,
    providerVersion: version,
  });
  connection = JSON.stringify({
    protocol: "pea-media-v1",
    baseUrl: helper.baseUrl,
    token: helper.token,
  });
  await reservation.writeFile(connection);
  await reservation.close();
} catch (e) {
  await reservation.close();
  await helper?.close();
  await unlink(connectionPath);
  throw e;
}
console.log(
  "Media Organizer ready. Open this connection file in the Premiere panel:\n" +
    connectionPath,
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await helper!.close();
  try {
    if ((await readFile(connectionPath, "utf8")) === connection)
      await unlink(connectionPath);
  } catch {}
  process.exit(0);
}
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
