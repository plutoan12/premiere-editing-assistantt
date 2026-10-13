import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { MediaProbeProvider } from "@pea/core";
import {
  CatalogConflictError,
  exportCatalog,
  ingest,
  setMetadataOverride,
  validDate,
} from "@pea/media-organizer";
import { openCatalog } from "./sqlite-store.js";
import { createFiles } from "./providers.js";
const pathsSchema = z
  .object({
    paths: z
      .array(
        z
          .string()
          .min(1)
          .max(16384)
          .refine((p) => isAbsolute(p) && !p.includes("\0")),
      )
      .min(1)
      .max(500),
  })
  .strict();
const editSchema = z
  .object({
    assetId: z.uuid(),
    field: z.enum(["captureDate", "deviceId"]),
    value: z.string().trim().min(1).max(128).nullable(),
    revision: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (edit) =>
      edit.field !== "captureDate" ||
      edit.value === null ||
      validDate(edit.value),
    "촬영일은 유효한 YYYY-MM-DD 날짜여야 합니다.",
  );
function send(res: ServerResponse, status: number, body: unknown) {
  if (!res.destroyed && !res.writableEnded) {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(body));
  }
}
function authorized(req: IncomingMessage, token: string) {
  const supplied = Buffer.from(req.headers.authorization ?? ""),
    expected = Buffer.from("Bearer " + token);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}
async function body(req: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 128 * 1024) throw new Error("BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export interface MediaServerOptions {
  catalogPath: string;
  probe: MediaProbeProvider;
  providerVersion: string;
}
export async function createMediaServer(options: MediaServerOptions) {
  const store = openCatalog(options.catalogPath),
    token = randomBytes(32).toString("base64url");
  // Persisted item results remain usable; interrupted work is explicitly retryable.
  const startup = await store.read();
  let recovered = false;
  for (const row of startup.jobs)
    if (row.job.status === "running" || row.job.status === "queued") {
      row.job.status = "failed";
      row.job.error =
        "INTERRUPTED: Local engine stopped before this job completed";
      recovered = true;
    }
  for (const scan of startup.scans) {
    if (scan.state !== "running") continue;
    const assetId = scan.existingAssetId ?? scan.result?.assetId;
    const asset = startup.assets.find((row) => row.asset.id === assetId);
    if (asset?.locations.includes(scan.uri)) asset.sourceState = "unverified";
    scan.state = "failed";
    scan.step = "done";
    scan.result = {
      scanId: scan.scanId,
      state: "failed",
      ...(assetId ? { assetId } : {}),
      ...(scan.result?.clipId ? { clipId: scan.result.clipId } : {}),
      error: {
        code: "INTERRUPTED",
        message: "Rescan interrupted; verify the source again",
      },
    };
    delete scan.verifiedAnalysis;
    recovered = true;
  }
  if (recovered) await store.commit(startup.revision, startup);
  let writer = false,
    active: AbortController | undefined,
    closing = false;
  const tasks = new Set<Promise<void>>();
  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (!authorized(req, token)) {
      send(res, 401, { error: "UNAUTHORIZED" });
      return;
    }
    // UXP does not use web-page CORS. Reject browser-origin requests; no CORS grants.
    if (req.headers.origin) {
      send(res, 403, { error: "ORIGIN_NOT_ALLOWED" });
      return;
    }
    if (closing) {
      send(res, 503, { error: "SHUTTING_DOWN" });
      return;
    }
    const route = req.url;
    if (req.method === "GET" && route === "/catalog") {
      send(res, 200, {
        catalog: exportCatalog(await store.read()),
        busy: writer,
      });
      return;
    }
    if (req.method === "POST" && route === "/cancel") {
      active?.abort();
      send(res, 200, { cancelled: !!active });
      return;
    }
    if (
      req.method !== "POST" ||
      !["/ingest", "/metadata"].includes(route ?? "")
    ) {
      send(res, 404, { error: "NOT_FOUND" });
      return;
    }
    if (writer) {
      send(res, 409, {
        error: "BUSY",
        message: "A catalog operation is already running",
      });
      return;
    }
    writer = true;
    try {
      const raw = await body(req);
      if (route === "/metadata") {
        const edit = editSchema.parse(raw),
          current = await store.read();
        if (current.revision !== edit.revision)
          throw new CatalogConflictError("catalog revision changed");
        const next = setMetadataOverride(
          current,
          { kind: "asset", id: edit.assetId },
          edit.field,
          edit.value,
        );
        send(res, 200, {
          catalog: exportCatalog(await store.commit(current.revision, next)),
        });
        return;
      }
      const input = pathsSchema.parse(raw),
        current = await store.read(),
        controller = new AbortController();
      active = controller;
      const abort = () => {
        if (!res.writableFinished) controller.abort();
      };
      res.once("close", abort);
      try {
        const inputs = [...new Set(input.paths)].map((path) => {
          const uri = pathToFileURL(path).href,
            matches = current.assets.filter((a) => a.locations.includes(uri));
          if (matches.length > 1)
            throw new CatalogConflictError("Ambiguous registered source path");
          const asset = matches[0],
            prior = asset
              ? [...current.scans]
                  .reverse()
                  .find(
                    (s) =>
                      s.uri === uri && s.result?.assetId === asset.asset.id,
                  )
              : undefined;
          return prior
            ? {
                scanId: prior.scanId,
                uri,
                ...(prior.existingAssetId
                  ? { existingAssetId: prior.existingAssetId }
                  : {}),
              }
            : {
                scanId: randomUUID(),
                uri,
                ...(asset ? { existingAssetId: asset.asset.id } : {}),
              };
        });
        const result = await ingest(
          inputs,
          {
            store,
            files: createFiles(),
            probe: options.probe,
            ids: randomUUID,
            providerVersion: options.providerVersion,
            settingsKey: "ffprobe-container-v1",
          },
          { signal: controller.signal },
        );
        send(res, 200, { result, catalog: exportCatalog(await store.read()) });
      } finally {
        res.off("close", abort);
        active = undefined;
      }
    } catch (e) {
      const status =
        e instanceof CatalogConflictError
          ? 409
          : e instanceof z.ZodError || e instanceof SyntaxError
            ? 400
            : e instanceof Error && e.message === "BODY_TOO_LARGE"
              ? 413
              : 500;
      send(res, status, {
        error: status === 500 ? "OPERATION_FAILED" : "INVALID_REQUEST",
        message:
          status === 500
            ? "Catalog operation failed; completed items are retained"
            : e instanceof Error
              ? e.message
              : "Invalid request",
      });
    } finally {
      writer = false;
    }
  }
  const server = createServer((req, res) => {
    const task = handle(req, res)
      .catch(() => send(res, 500, { error: "OPERATION_FAILED" }))
      .finally(() => tasks.delete(task));
    tasks.add(task);
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (e) {
    store.close();
    throw e;
  }
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Local engine failed to bind");
  let closePromise: Promise<void> | undefined;
  return {
    baseUrl: `http://localhost:${address.port}`,
    token,
    close() {
      if (closePromise) return closePromise;
      closing = true;
      active?.abort();
      closePromise = (async () => {
        const stopped = new Promise<void>((resolve, reject) =>
          server.close((e) => (e ? reject(e) : resolve())),
        );
        server.closeAllConnections();
        await Promise.all([stopped, ...tasks]);
        store.close();
      })();
      return closePromise;
    },
  };
}
