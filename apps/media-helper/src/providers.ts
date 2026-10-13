import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ProviderContext, MediaProbeProvider } from "@pea/core";
import {
  ProbeRecordSchema,
  type ProbeRecord,
  type ReadOnlyFiles,
} from "@pea/media-organizer";
import { runProcess } from "./vendor/process-runner.js";
export function sourcePath(uri: string): string {
  const url = new URL(uri);
  if (url.protocol !== "file:" || url.host || url.search || url.hash)
    throw new Error("A local file URI is required");
  const path = fileURLToPath(url);
  if (path.includes("\0")) throw new Error("Invalid source path");
  return path;
}
const check = (ctx?: ProviderContext) => {
  ctx?.signal?.throwIfAborted();
};
export function createFiles(): ReadOnlyFiles {
  return {
    async stat(uri) {
      const s = await stat(sourcePath(uri), { bigint: true });
      if (!s.isFile()) throw new Error("Source must be a regular file");
      return {
        size: s.size,
        mtimeNs: s.mtimeNs,
        identity: `${s.dev}:${s.ino}:${s.ctimeNs}`,
      };
    },
    async sha256(uri, ctx) {
      check(ctx);
      const path = sourcePath(uri),
        handle = await open(path, "r");
      try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile() || before.size > BigInt(Number.MAX_SAFE_INTEGER))
          throw new Error("Unsupported source");
        const hash = createHash("sha256"),
          buffer = Buffer.allocUnsafe(1024 * 1024);
        let position = 0;
        while (BigInt(position) < before.size) {
          check(ctx);
          const length = Number(
            before.size - BigInt(position) > BigInt(buffer.length)
              ? BigInt(buffer.length)
              : before.size - BigInt(position),
          );
          const { bytesRead } = await handle.read(buffer, 0, length, position);
          if (!bytesRead) throw new Error("Source changed during read");
          hash.update(buffer.subarray(0, bytesRead));
          position += bytesRead;
        }
        check(ctx);
        const after = await handle.stat({ bigint: true }),
          current = await stat(path, { bigint: true });
        for (const s of [after, current])
          if (
            !s.isFile() ||
            s.size !== before.size ||
            s.ino !== before.ino ||
            s.dev !== before.dev ||
            s.mtimeNs !== before.mtimeNs ||
            s.ctimeNs !== before.ctimeNs
          )
            throw new Error("Source changed during read");
        return hash.digest("hex");
      } finally {
        await handle.close();
      }
    },
  };
}
const tags = z.record(z.string(), z.string()).optional();
const stream = z.object({
  codec_type: z.string(),
  disposition: z
    .object({ attached_pic: z.number().int().optional() })
    .optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  channels: z.number().int().nonnegative().optional(),
  avg_frame_rate: z.string().optional(),
  tags,
});
const probeSchema = z.object({
  format: z
    .object({
      duration: z.string().optional(),
      format_name: z.string().optional(),
      tags,
    })
    .optional(),
  streams: z.array(stream).min(1),
});
export function normalizeProbe(input: unknown, version: string): ProbeRecord {
  const data = probeSchema.parse(input),
    v = data.streams.find(
      (s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1,
    ),
    a = data.streams.find((s) => s.codec_type === "audio");
  if (!v && !a) throw new Error("No supported media stream");
  const still =
    !!v &&
    /^(image2|png_pipe|jpeg_pipe|webp_pipe|bmp_pipe|tiff_pipe)$/.test(
      data.format?.format_name ?? "",
    );
  const result: ProbeRecord = {
    mediaKind: still ? "image" : v ? "video" : "audio",
    candidates: [],
  };
  const duration = data.format?.duration;
  if (duration && /^\d{1,16}(?:\.\d{1,9})?$/.test(duration)) {
    const [whole, fraction = ""] = duration.split("."),
      ticks = BigInt(whole + fraction);
    if (ticks > 0n)
      result.duration = {
        ticks,
        timebase: { numerator: 1, denominator: 10 ** fraction.length },
      };
  }
  if (!still && !result.duration)
    throw new Error("Missing or invalid source duration");
  if (v) {
    result.width = v.width;
    result.height = v.height;
    if (
      !still &&
      v.avg_frame_rate &&
      /^\d+\/[1-9]\d*$/.test(v.avg_frame_rate)
    ) {
      const [numerator, denominator] = v.avg_frame_rate.split("/").map(Number);
      if (
        Number.isSafeInteger(numerator) &&
        numerator > 0 &&
        Number.isSafeInteger(denominator)
      )
        result.frameRate = {
          rate: { numerator, denominator },
          dropFrame: false,
        };
    }
  }
  if (a) result.audioChannels = a.channels;
  // No cadence claim: average/nominal rates alone cannot distinguish VFR.
  for (const bag of [data.format?.tags, ...data.streams.map((s) => s.tags)]) {
    const raw = bag?.creation_time;
    if (!raw || !/^\d{4}-\d{2}-\d{2}[T ]/.test(raw)) continue;
    const timezone = /(Z|[+-]\d{2}:\d{2})$/.exec(raw)?.[1];
    result.candidates.push({
      field: "captureDate",
      value: raw.slice(0, 10),
      rawValue: raw,
      source: "probe",
      provenance: { provider: "ffprobe", version },
      ...(timezone ? { timezone } : {}),
    });
  }
  return ProbeRecordSchema.parse(result);
}
export async function createProbe(
  ffprobePath: string,
): Promise<{ probe: MediaProbeProvider; version: string }> {
  const info = await runProcess(ffprobePath, ["-version"], {
      timeoutMs: 10000,
      maxOutputBytes: 65536,
    }),
    version = info.stdout.split("\n")[0];
  if (!version.startsWith("ffprobe version "))
    throw new Error("Unrecognized ffprobe executable");
  return {
    version,
    probe: {
      async probe({ uri }, ctx) {
        check(ctx);
        const out = await runProcess(
          ffprobePath,
          [
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            sourcePath(uri),
          ],
          {
            timeoutMs: 30000,
            maxOutputBytes: 2 * 1024 * 1024,
            signal: ctx?.signal,
          },
        );
        check(ctx);
        if (out.stderr.trim()) throw new Error("Media contains probe errors");
        return normalizeProbe(JSON.parse(out.stdout), version);
      },
    },
  };
}
