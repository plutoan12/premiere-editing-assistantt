# Subtitle Caption Bridge

A separate CEP companion adds the current revision of a saved Subtitle **sequence** document to Premiere as a new subtitle caption track. The existing UXP Subtitle panel handles transcription, editing and document persistence. This companion uses the documented ExtendScript caption API through Adobe's `CSInterface.js`.

## Workflow

1. Save the edited sequence document as Subtitle JSON in the UXP panel. Source documents must first be saved as a sequence document with an explicit timeline start; this companion rejects source documents.
2. Save the Premiere project and activate the intended sequence.
3. In **Subtitle · 캡션 적용**, choose the JSON document. Read the project path, sequence name and sequence ID displayed in the panel.
4. Click **새 캡션 트랙 적용** once. The explicit document timeline offset is included in the application SRT. The host verifies the pinned project/sequence before importing or creating the track.
5. Inspect the caption content and timing in Premiere. A successful API return is reported as Premiere acknowledging creation; it is not a visual inspection of every cue.

The companion retains an application SRT at `SystemPath.USER_DATA/PeaCaptionBridge/caption-<request-id>.srt`, using CEP UTF-8 file APIs and validating the saved content before dispatch. Premiere may reference this imported file, so it is not deleted after applying. Existing caption tracks are not replaced. Import may leave an SRT project item if the following caption creation step fails.

Once a request is dispatched, the same document ID/revision, project/sequence and SHA-256 of the prepared SRT are blocked by a persistent local record, including after panel reload. Different edits forked from an older document can share a revision ID; their different SRT contents remain independently applicable. WebCrypto content hashing must be available or application is refused. The host also rejects a repeated request ID. Timeout, invalid response or an unknown host result stops further actions in that panel instance. No automatic retry is performed. Check Premiere before reopening the panel or intentionally preparing a new document revision. Clearing panel storage bypasses the UI duplicate history and is not part of normal operation.

Current limitation: every dispatched attempt consumes that content/target combination, including a known host rejection before importing media. The UI has no retry/reset operation yet. Failures before dispatch, such as an SRT write error or a changed target, do not consume it.

The browser bundle uses no Node integration, external web content, network access, or dynamic document HTML. `FileReader` reads the file selected by the user. This panel currently targets Premiere 25.6+ with CEP 12; actual installed-host compatibility remains subject to a host acceptance run.

## Build and tests

From the repository root:

```sh
pnpm --filter @pea/premiere-caption-bridge test
pnpm --filter @pea/premiere-caption-bridge typecheck
pnpm --filter @pea/premiere-caption-bridge build
```

The build stages plain files at `dist/premiere-caption-bridge`. It does not install, sign, enable developer bypasses, or change Premiere settings. Tests run the actual browser bundle and document preparation with CEP/file/DOM boundaries faked, plus the actual JSX in a controlled host model. Passing these tests does not establish real Premiere acceptance.

`node --test scripts/sign-caption-bridge.test.mjs` separately tests signing publication and cleanup with the external SDK/process boundary controlled. It checks both archive and extracted-folder verification, refusal of symlinks, refusal of partial verification, and removal of the private key even after failure.

## Signing and distribution without PlayerDebugMode

Adobe's [PProPanel guide](https://github.com/Adobe-CEP/Samples/blob/e4946b73ac1e566dced8e95dba10811c31036927/PProPanel/ReadMe.md) documents self-signed certificates for direct distribution as well as certificates from commercial authorities. The [packaging guide](https://github.com/Adobe-CEP/Getting-Started-guides/blob/master/Package%20Distribute%20Install/readme.md) describes package signing, timestamping and verification. CEP checks the signature when loading the extension. PlayerDebugMode is an unsigned-development bypass and is not needed for a valid signed extension.

Official SDK: [`ZXPSignCmd` 4.1.3, CEP-Resources revision `ab5e4e3e53a42fad08e1225a22a991bb1ffe73f6`](https://github.com/Adobe-CEP/CEP-Resources/tree/ab5e4e3e53a42fad08e1225a22a991bb1ffe73f6/ZXPSignCMD/4.1.3). The downloaded macOS binary has SHA-256 `bc773fae0b97416fc7a462e7dadcc00270428a9913480c9b78b5606ff1cfb095` and is **x86_64**, not a universal/arm64 binary. On the inspected arm64 Mac, execution returned `bad CPU type in executable`; no certificate or signed package was created. The signing binary is kept only in ignored `build/deps`, not in the extension. It is subject to the Adobe SDK license, not the Samples MIT license.

The repository's **Subtitle Caption Package** workflow provides the compatible signing environment on GitHub's standard [`macos-15-intel` runner](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job). It runs on pushes to `codex/subtitle-review-workflow` and on relevant pull requests, with read-only repository permission and a 15-minute timeout. Actions are pinned to commit SHAs. After tests and build, `scripts/sign-caption-bridge.mjs` downloads the pinned official SDK, verifies its SHA-256 before execution, creates an ephemeral self-signed certificate, signs with timestamping, and verifies both the ZXP and a freshly extracted directory. Only `pea-caption-bridge.zxp` and `pea-caption-bridge-verification.txt` are uploaded. The private certificate remains in a restricted temporary directory and is deleted in a finally block; its password is never included in published evidence or command errors. The workflow does not install the extension or prove that Premiere loads it. A new signing identity is created each run, so these artifacts are for review/direct testing rather than a stable publisher certificate.

On a supported signing environment, the official workflow is:

```sh
ZXPSignCmd -sign ./dist/premiere-caption-bridge ./dist/pea-caption-bridge.zxp "$CAPTION_CERT_PATH" "$CAPTION_CERT_PASSWORD" -tsa http://timestamp.digicert.com/
ZXPSignCmd -verify ./dist/pea-caption-bridge.zxp -certinfo
```

Create the certificate through the SDK's documented `-selfSignedCert` command or supply an existing appropriate certificate. Keep the certificate and password outside source control. Timestamping protects validation after the signing certificate expires; confirm the selected timestamp service works in the signing environment.

Adobe's current supported direct installation path is [UPIA](https://helpx.adobe.com/creative-cloud/apps/integration-with-other-apps/manage-plugins/install-plugins-using-upia-tool.html), using `UnifiedPluginInstallerAgent --install /absolute/path/pea-caption-bridge.zxp`. Its binary exists in the inspected Creative Cloud installation, but no installation was attempted.

The [CEP 12 cookbook](https://github.com/Adobe-CEP/CEP-Resources/blob/ab5e4e3e53a42fad08e1225a22a991bb1ffe73f6/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md) also documents the macOS per-user extension folder `~/Library/Application Support/Adobe/CEP/extensions`. The packaging guide explicitly permits `ZXPSignCmd -verify <extensionRootDir>` as well as ZXP verification. This provides a verification route for an intact extracted package, including its signature metadata; extraction alone is not evidence of valid signing or actual host loading. Prefer the documented UPIA path for installation and verify any extracted folder before treating it as signed.

Adobe documents a [CEP signature-validation issue](https://github.com/Adobe-CEP/CEP-Resources/blob/ab5e4e3e53a42fad08e1225a22a991bb1ffe73f6/ZXPSignCMD/KnownIssue2024.md). Its developer guidance includes signing on the target platform, using real files rather than symlinks, and removing `.DS_Store`/`__MACOSX`. This build copies only the required plain files and has no `node_modules` in its payload. It never requests debug-mode or security-setting changes as a workaround.

Upstream runtime versions, hashes and notices are recorded in [vendor/README.md](vendor/README.md).
