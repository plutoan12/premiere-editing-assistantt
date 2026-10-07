import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sdkRevision = "ab5e4e3e53a42fad08e1225a22a991bb1ffe73f6";
const sdkHash = "bc773fae0b97416fc7a462e7dadcc00270428a9913480c9b78b5606ff1cfb095";
const sdkURL = `https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/${sdkRevision}/ZXPSignCMD/4.1.3/macOS/ZXPSignCmd`;
const timestampURL = "http://timestamp.digicert.com/";
const exec = promisify(execFile);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

async function runCommand(executable, args) {
  const { stdout, stderr } = await exec(executable, args, { timeout: 120000, maxBuffer: 1024 * 1024, encoding: "utf8" });
  return `${stdout}${stderr}`;
}

export function assertVerifiedOutput(output) {
  if (!/^Signature verified successfully\s*$/m.test(output) || /^\s*Error\b/im.test(output)) {
    throw new Error(`SDK verification did not report full success:\n${output}`);
  }
}

async function plainFiles(directory, prefix = "") {
  const rootInfo = await lstat(directory);
  if (rootInfo.isSymbolicLink()) throw new Error(`Refusing symlink payload: ${directory}`);
  if (!rootInfo.isDirectory()) throw new Error(`Payload must be a directory: ${directory}`);
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name), relative = prefix ? `${prefix}/${name}` : name;
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Refusing symlink payload: ${relative}`);
    if ([".DS_Store", "__MACOSX", "node_modules", ".git", "META-INF"].includes(name) || /\.(?:p12|pfx|pem|key)$/i.test(name)) {
      throw new Error(`Unexpected signing payload entry: ${relative}`);
    }
    if (info.isDirectory()) files.push(...await plainFiles(path, relative));
    else if (info.isFile()) files.push({ path, relative, hash: sha256(await readFile(path)) });
    else throw new Error(`Refusing non-file payload entry: ${relative}`);
  }
  return files;
}

/** Command execution is injectable for tests; the CLI always supplies the hash-verified official SDK. */
export async function signPayload({ payloadDir, outputDir, signerPath, run = runCommand, revision = process.env.GITHUB_SHA ?? "local-unrecorded" }) {
  const files = await plainFiles(payloadDir);
  if (!files.some(file => file.relative === "CSXS/manifest.xml")) throw new Error("Payload is missing CSXS/manifest.xml");
  const staging = await mkdtemp(join(tmpdir(), "pea-caption-sign-"));
  await chmod(staging, 0o700);
  const certificate = join(staging, "ephemeral.p12"), archive = join(staging, "pea-caption-bridge.zxp");
  const extracted = join(staging, "extracted");
  const password = randomBytes(32).toString("hex");
  try {
    await run(signerPath, ["-selfSignedCert", "KR", "Seoul", "PEA", "Subtitle Caption Bridge CI", password, certificate, "-validityDays", "365"]);
    await chmod(certificate, 0o600);
    const signOutput = await run(signerPath, ["-sign", payloadDir, archive, certificate, password, "-tsa", timestampURL]);
    if (!/^Signed successfully\s*$/m.test(signOutput) || /^\s*Error\b/im.test(signOutput)) throw new Error(`Signing failed:\n${signOutput}`);
    const archiveOutput = await run(signerPath, ["-verify", archive, "-certinfo"]);
    assertVerifiedOutput(archiveOutput);
    await run("/usr/bin/ditto", ["-x", "-k", archive, extracted]);
    const directoryOutput = await run(signerPath, ["-verify", extracted, "-certinfo"]);
    assertVerifiedOutput(directoryOutput);
    const archiveBytes = await readFile(archive);
    const evidence = [
      "Subtitle Caption Bridge signing verification", `Source revision: ${revision}`,
      "Signer: official Adobe ZXPSignCmd 4.1.3 macOS x86_64", `SDK revision: ${sdkRevision}`, `SDK SHA-256: ${sdkHash}`,
      `Timestamp service: ${timestampURL}`, "Certificate: generated for this run; private key and password are not published",
      `ZXP SHA-256: ${sha256(archiveBytes)}`, "", "Package verification:", archiveOutput.trim(),
      "", "Extracted directory verification:", directoryOutput.trim(), "", "Unsigned payload SHA-256:",
      ...files.map(file => `${file.hash}  ${file.relative}`), "",
      "This verifies package signatures only. It does not prove Premiere installation, loading, or caption correctness.", ""
    ].join("\n");
    // Publish only after both verifications succeeded; no certificate ever enters the output folder.
    await mkdir(outputDir, { recursive: true });
    await copyFile(archive, join(outputDir, "pea-caption-bridge.zxp"));
    await writeFile(join(outputDir, "pea-caption-bridge-verification.txt"), evidence);
    return { archive: join(outputDir, "pea-caption-bridge.zxp"), evidence: join(outputDir, "pea-caption-bridge-verification.txt") };
  } catch (error) {
    // execFile error messages can contain argv; the random certificate password must never reach a CI log.
    throw new Error(String(error instanceof Error ? error.message : error).replaceAll(password, "[redacted]"));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function main() {
  if (process.platform !== "darwin" || process.arch !== "x64") {
    throw new Error("The official signing SDK requires macOS x86_64. Use the macos-15-intel CI job; no local compatibility or security settings are changed.");
  }
  const deps = join(root, "build/deps/cep-signing"), signerPath = join(deps, "ZXPSignCmd-4.1.3");
  await mkdir(deps, { recursive: true });
  let bytes;
  try { bytes = await readFile(signerPath); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const response = await fetch(sdkURL, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`SDK download failed (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (sha256(bytes) !== sdkHash) throw new Error("Official signing SDK SHA-256 mismatch; refusing to execute it.");
  await writeFile(signerPath, bytes, { mode: 0o700 });
  await chmod(signerPath, 0o700);
  const result = await signPayload({ payloadDir: join(root, "dist/premiere-caption-bridge"),
    outputDir: join(root, "dist/caption-signed"), signerPath });
  console.log(`Signed ZXP: ${result.archive}\nVerification evidence: ${result.evidence}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
