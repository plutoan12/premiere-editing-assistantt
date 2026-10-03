import { chmod, readFile, writeFile } from "node:fs/promises";
import { createWhisperCppProvider } from "@pea/whisper-cpp";
import { startHelperServer } from "./server.js";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

async function main() {
  const bootstrapPath = required("PEA_BOOTSTRAP");
  const provider = createWhisperCppProvider({
    ffmpegPath: required("PEA_FFMPEG"),
    whisperPath: required("PEA_WHISPER"),
    modelPath: required("PEA_MODEL"),
    language: process.env.PEA_LANGUAGE ?? "auto"
  });
  const keyPath = process.env.PEA_TLS_KEY;
  const certPath = process.env.PEA_TLS_CERT;
  const dev = process.env.PEA_ALLOW_INSECURE_DEV === "1";
  const tls = keyPath && certPath ? { key: await readFile(keyPath), cert: await readFile(certPath) } : undefined;
  const helper = await startHelperServer({ provider, tls, allowInsecureDev: dev });
  await writeFile(bootstrapPath, JSON.stringify({
    endpoint: helper.endpoint,
    token: helper.token,
    protocolVersion: helper.protocolVersion,
    helperVersion: helper.helperVersion
  }, null, 2), { mode: 0o600 });
  await chmod(bootstrapPath, 0o600);
  process.stdout.write(`PEA helper listening on ${helper.endpoint}\nbootstrap: ${bootstrapPath}\n`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    await helper.stop().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
