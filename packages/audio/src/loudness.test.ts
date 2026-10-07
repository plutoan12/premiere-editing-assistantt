import { describe, expect, it } from "vitest";
import { proposeNormalization } from "./loudness.js";

const target = { integratedLufs: -16, maxTruePeakDbtp: -1, maxGainDb: 12 };
describe("loudness normalization proposals", () => {
  it("reaches the requested target when headroom allows", () => {
    expect(proposeNormalization({ integratedLufs: -20, truePeakDbtp: -8 }, target)).toMatchObject({ status: "ok", gainDb: 4, targetReached: true, limitedBy: null });
  });
  it("limits positive gain by measured true-peak headroom", () => {
    expect(proposeNormalization({ integratedLufs: -24, truePeakDbtp: -3 }, target)).toMatchObject({ gainDb: 2, targetReached: false, limitedBy: "true-peak" });
  });
  it("reduces already-clipping material even when the loudness target asks for gain", () => {
    expect(proposeNormalization({ integratedLufs: -24, truePeakDbtp: 2 }, target)).toMatchObject({ gainDb: -3, targetReached: false });
  });
  it("applies the positive gain budget", () => {
    expect(proposeNormalization({ integratedLufs: -60, truePeakDbtp: -50 }, target)).toMatchObject({ gainDb: 12, limitedBy: "max-gain" });
  });
  it("does not propose gain for silence or missing true peak", () => {
    expect(proposeNormalization({ integratedLufs: null, truePeakDbtp: null }, target)).toEqual({ status: "silence", gainDb: null });
    expect(proposeNormalization({ integratedLufs: -24, truePeakDbtp: null }, target)).toEqual({ status: "unsupported", gainDb: null });
  });
  it("rejects nonfinite readings or invalid settings", () => {
    expect(() => proposeNormalization({ integratedLufs: Infinity, truePeakDbtp: 0 }, target)).toThrow();
    expect(() => proposeNormalization({ integratedLufs: -20, truePeakDbtp: -1 }, { ...target, maxGainDb: -1 })).toThrow();
  });
  it("rejects finite-but-overflowing measurements rather than emitting Infinity", () => {
    expect(() => proposeNormalization({ integratedLufs: -1e308, truePeakDbtp: 1e308 }, { integratedLufs: 1e308, maxTruePeakDbtp: -1e308, maxGainDb: 12 })).toThrow();
  });
});
