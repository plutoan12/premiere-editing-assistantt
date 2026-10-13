import { z } from "zod";
import {
  validateCatalog,
  type CatalogState,
  type CatalogStore,
} from "./catalog.js";
import { FileStampSchema, sameStamp, type ReadOnlyFiles } from "./scan.js";
const RelinkRequestSchema = z
  .object({
    mediaAssetId: z.string().min(1),
    fromUri: z.string().min(1),
    toUri: z.string().min(1),
    expectedFileRevision: z.number().int().positive(),
  })
  .strict();
export type RelinkRequest = z.infer<typeof RelinkRequestSchema>;
export type RelinkPreview = {
  request: RelinkRequest;
  status: "verified" | "ambiguous" | "mismatch" | "offline";
  observedSha256?: string;
};
const normalizedLocation = (uri: string) => {
  try {
    return decodeURI(uri).normalize("NFC").toLowerCase();
  } catch {
    return uri.normalize("NFC").toLowerCase();
  }
};
export async function prepareRelink(
  input: CatalogState,
  raw: RelinkRequest,
  files: ReadOnlyFiles,
): Promise<RelinkPreview> {
  const state = validateCatalog(input),
    request = RelinkRequestSchema.parse(raw);
  const record = state.assets.find((x) => x.asset.id === request.mediaAssetId);
  if (!record || !record.locations.includes(request.fromUri))
    throw new Error("relink source is not registered");
  if (record.fileRevision !== request.expectedFileRevision)
    throw new Error("file revision changed");
  if (
    state.assets.some((a) =>
      a.locations.some(
        (uri) =>
          !(a.asset.id === request.mediaAssetId && uri === request.fromUri) &&
          normalizedLocation(uri) === normalizedLocation(request.toUri),
      ),
    )
  )
    return { request, status: "ambiguous" };
  try {
    const before = FileStampSchema.parse(await files.stat(request.toUri));
    const observedSha256 = z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .parse(await files.sha256(request.toUri))
      .toLowerCase();
    const after = FileStampSchema.parse(await files.stat(request.toUri));
    const verified =
      sameStamp(before, after) &&
      observedSha256 === record.asset.fingerprint.value.toLowerCase();
    return {
      request,
      status: verified ? "verified" : "mismatch",
      observedSha256,
    };
  } catch (error) {
    if ((error as { code?: string })?.code === "ENOENT")
      return { request, status: "offline" };
    throw error;
  }
}
export async function commitRelink(
  store: CatalogStore,
  raw: RelinkRequest,
  files: ReadOnlyFiles,
): Promise<CatalogState> {
  const state = await store.read(),
    preview = await prepareRelink(state, raw, files);
  if (preview.status !== "verified")
    throw new Error(`relink requires review: ${preview.status}`);
  const request = preview.request,
    record = state.assets.find((x) => x.asset.id === request.mediaAssetId)!;
  record.locations = record.locations.map((uri) =>
    uri === request.fromUri ? request.toUri : uri,
  );
  if (record.asset.uri === request.fromUri) record.asset.uri = request.toUri;
  record.availability = "online";
  return store.commit(state.revision, state);
}
