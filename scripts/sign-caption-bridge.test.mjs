import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertVerifiedOutput, signPayload } from "./sign-caption-bridge.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "caption-sign-test-"));
  const payloadDir = join(root, "payload"), outputDir = join(root, "published");
  await mkdir(join(payloadDir, "CSXS"), { recursive: true });
  await writeFile(join(payloadDir, "CSXS/manifest.xml"), "<ExtensionManifest />");
  await writeFile(join(payloadDir, "index.html"), "<html></html>");
  return { root, payloadDir, outputDir };
}

// The command runner is the external SDK/process boundary. File handling, publication and cleanup are real.
function commandRunner(failVerification = false) {
  let certificate, secret;
  const steps = [];
  return {
    get certificate() { return certificate; }, get secret() { return secret; }, steps,
    async run(executable, args) {
      steps.push(args[0]);
      if (args[0] === "-selfSignedCert") {
        secret = args[5]; certificate = args[6];
        await writeFile(certificate, "private key fixture"); return "Self-signed certificate generated successfully\n";
      }
      if (args[0] === "-sign") { await writeFile(args[2], "signed ZXP fixture"); return "Signed successfully\n"; }
      if (args[0] === "-verify") {
        return failVerification ? "Error - Failed to verify signature.\n" : "Signing Certificate: Valid\nSignature verified successfully\n";
      }
      assert.equal(executable, "/usr/bin/ditto");
      const destination = args[3]; await mkdir(join(destination, "META-INF"), { recursive: true });
      await writeFile(join(destination, "META-INF/signatures.xml"), "signed metadata");
      return "";
    }
  };
}

test("publishes only the signed archive and evidence after package and extracted-folder verification, deleting the key", async () => {
  const f = await fixture(), commands = commandRunner();
  try {
    await signPayload({ ...f, signerPath: "/official/ZXPSignCmd", run: commands.run, revision: "fixture-commit" });
    assert.deepEqual((await readdir(f.outputDir)).sort(), ["pea-caption-bridge-verification.txt", "pea-caption-bridge.zxp"]);
    const evidence = await readFile(join(f.outputDir, "pea-caption-bridge-verification.txt"), "utf8");
    assert.match(evidence, /fixture-commit/); assert.match(evidence, /Extracted directory/);
    assert.equal(evidence.includes(commands.secret), false);
    assert.equal(commands.steps.filter(step => step === "-verify").length, 2);
    await assert.rejects(access(commands.certificate), { code: "ENOENT" });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("a failed verification publishes nothing and still deletes the private key", async () => {
  const f = await fixture(), commands = commandRunner(true);
  try {
    await assert.rejects(signPayload({ ...f, signerPath: "/official/ZXPSignCmd", run: commands.run }), /verif/i);
    await assert.rejects(access(f.outputDir), { code: "ENOENT" });
    await assert.rejects(access(commands.certificate), { code: "ENOENT" });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("symlinked payloads are rejected before the signing SDK executes", async () => {
  const f = await fixture(), commands = commandRunner();
  try {
    await symlink(join(f.payloadDir, "index.html"), join(f.payloadDir, "linked.html"));
    await assert.rejects(signPayload({ ...f, signerPath: "/official/ZXPSignCmd", run: commands.run }), /symlink/i);
    assert.equal(commands.steps.length, 0);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("partial chain or revocation verification messages are not treated as full verification", () => {
  assert.doesNotThrow(() => assertVerifiedOutput("Signature verified successfully\n"));
  assert.throws(() => assertVerifiedOutput("Signature and file references verified successfully, but certificate chain could not be verified\n"), /verif/i);
  assert.throws(() => assertVerifiedOutput("Error - Failed to verify signature.\nSignature verified successfully\n"), /verif/i);
});
