/** Premiere can return decomposed Mac project paths after reopening a project. */
export function projectPathKey(path: string, platform: string): string {
  return platform === "darwin" ? path.normalize("NFC") : path;
}
