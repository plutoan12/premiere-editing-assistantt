export const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
export const time = (ticks: bigint, denominator = 1) => ({
  ticks,
  timebase: { numerator: 1, denominator },
});
export const assetRecord = (n = 1, uri = "file:///shoot/A001.mov") => ({
  asset: {
    id: id(n),
    uri,
    readOnly: true as const,
    fingerprint: { algorithm: "sha256" as const, value: "a".repeat(64) },
  },
  fileRevision: 1,
  locations: [uri],
  duration: time(10n),
  availability: "online" as const,
});
export const clip = (n = 2, asset = 1) => ({
  id: id(n),
  mediaAssetId: id(asset),
  sourceRange: { start: time(0n), duration: time(10n) },
});
