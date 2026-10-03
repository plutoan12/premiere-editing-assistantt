import { describe, expect, it } from "vitest";
import { parseSrt, parseVtt, toSrt, toVtt } from "./subtitles.js";

describe("subtitle interchange", () => {
  it("parses and writes SRT without losing multiline text", () => {
    const source = "1\n00:00:01,250 --> 00:00:03,000\nhello\nworld\n";
    const transcript = parseSrt(source, "media-1");
    expect(transcript.segments[0].range.start.ticks).toBe(1250n);
    expect(transcript.segments[0].text).toBe("hello\nworld");
    expect(toSrt(transcript)).toContain("00:00:01,250 --> 00:00:03,000");
  });

  it("parses VTT cue settings and emits WEBVTT", () => {
    const source = "WEBVTT\n\n00:00:02.000 --> 00:00:04.500 align:start\ncaption\n";
    const transcript = parseVtt(source, "media-2");
    expect(transcript.segments[0].range.duration.ticks).toBe(2500n);
    expect(toVtt(transcript)).toContain("WEBVTT");
  });

  it("rejects backwards subtitle ranges", () => {
    expect(() => parseSrt("1\n00:00:03,000 --> 00:00:02,000\nbad", "media")).toThrow();
  });
});
