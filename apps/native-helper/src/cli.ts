import { chmod, readFile, writeFile } from "node:fs/promises";
import { createWhisperCppProvider } from "@pea/whisper-cpp";
import { createFFmpegMediaProvider } from "@pea/rough-media";
import { startHelperServer } from "./server.js";
const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
async function main() {
  const bootstrapPath = required("PEA_BOOTSTRAP");
  const hasTranscript = !!(process.env.PEA_WHISPER || process.env.PEA_MODEL);
  const provider = hasTranscript ? createWhisperCppProvider({ ffmpegPath: required("PEA_FFMPEG"), whisperPath: required("PEA_WHISPER"), modelPath: required("PEA_MODEL"), language: process.env.PEA_LANGUAGE ?? "auto" }) : undefined;
  let mediaProvider;
  if (process.env.PEA_AUDIO_ROOTS) {
    const roots: unknown = JSON.parse(process.env.PEA_AUDIO_ROOTS);
    if (!Array.isArray(roots) || !roots.length || roots.some(r => typeof r !== 'string' || !r.startsWith('/'))) throw new Error('PEA_AUDIO_ROOTS must be a nonempty JSON array of permitted absolute directories');
    mediaProvider = createFFmpegMediaProvider({ ffmpegPath: required('PEA_FFMPEG'), ffprobePath: required('PEA_FFPROBE'), allowedRoots: roots });
  }
  if (!provider && !mediaProvider) throw new Error('Configure PEA_AUDIO_ROOTS for rough-cut or PEA_WHISPER/PEA_MODEL for transcription');
  const keyPath = process.env.PEA_TLS_KEY, certPath = process.env.PEA_TLS_CERT;
  if (!!keyPath !== !!certPath) throw new Error('Set both PEA_TLS_KEY and PEA_TLS_CERT');
  const tls = keyPath && certPath ? { key: await readFile(keyPath), cert: await readFile(certPath) } : undefined;
  const helper = await startHelperServer({ provider, mediaProvider, tls, allowInsecureDev: process.env.PEA_ALLOW_INSECURE_DEV === '1' });
  // Exclusive creation avoids overwriting a previous session or following a pre-existing symlink.
  await writeFile(bootstrapPath, JSON.stringify({ endpoint: helper.endpoint, token: helper.token, protocolVersion: helper.protocolVersion, helperVersion: helper.helperVersion }, null, 2), { mode: 0o600, flag: 'wx' });
  await chmod(bootstrapPath, 0o600);
  process.stdout.write(`PEA helper listening on ${helper.endpoint}\nbootstrap: ${bootstrapPath}\n`);
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await helper.stop().catch(() => undefined); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
