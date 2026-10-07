import { expect, it } from "vitest";
import * as core from "./index.js";
const t = (ticks: bigint, denominator = 1) => ({
  ticks,
  timebase: { numerator: 1, denominator },
});
it("round trips integers beyond Number precision", () => {
  const time = {
    ticks: 9007199254740993n,
    timebase: { numerator: 1001, denominator: 30000 },
  };
  expect(core.decodeMediaTime(core.encodeMediaTime(time))).toEqual(time);
});
it.each(["1.5", "1e3", 3, "01", "-0", "+1"])(
  "rejects noncanonical wire ticks %s",
  (ticks) => {
    expect(() =>
      core.decodeMediaTime({
        ticks,
        timebase: { numerator: 1, denominator: 1 },
      }),
    ).toThrow();
  },
);
it("rejects invalid timebases", () => {
  expect(() =>
    core.decodeMediaTime({
      ticks: "1",
      timebase: { numerator: 1, denominator: 0 },
    }),
  ).toThrow();
});
it("adds different rational timebases exactly", () => {
  expect(core.addMediaTime(t(1n, 2), t(1n, 3))).toEqual(t(5n, 6));
  expect(core.addMediaTime(t(-1n, 2), t(1n, 2))).toEqual(t(0n));
  expect(() =>
    core.addMediaTime(t(1n, 9007199254740991), t(1n, 9007199254740990)),
  ).toThrow(/safe/);
});
it("checks source range boundaries without floating point rounding", () => {
  expect(
    core.validateBoundedTimeRange(
      { start: t(1n, 2), duration: t(1n, 2) },
      t(1n),
    ),
  ).toBeTruthy();
  for (const range of [
    { start: t(-1n), duration: t(1n) },
    { start: t(0n), duration: t(0n) },
    { start: t(1n), duration: t(1n, 30000) },
  ]) {
    expect(() => core.validateBoundedTimeRange(range, t(1n))).toThrow();
  }
});
