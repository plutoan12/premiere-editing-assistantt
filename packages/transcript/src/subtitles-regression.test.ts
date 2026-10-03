import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { parseSrt, parseVtt, toSrt, toVtt } from "./subtitles.js";

describe("subtitle interchange regressions", () => {
  it("reads short WebVTT timestamps", () => {
    assert.equal(parseVtt("WEBVTT\n\n01:02.500 --> 01:04.000\n안녕", "m").segments[0].range.start.ticks, 62500n);
  });
  it("ignores WebVTT metadata blocks instead of treating them as captions", () => {
    const t = parseVtt("WEBVTT\n\nNOTE description\nignored\n\nSTYLE\n::cue { color: white; }\n\nREGION\nid:r\n\ncue-1\n00:01.000 --> 00:02.000 align:start\n字幕", "m");
    assert.equal(t.segments.length, 1);
    assert.equal(t.segments[0].text, "字幕");
  });
  it("accepts an empty WebVTT document", () => assert.equal(parseVtt("WEBVTT", "m").segments.length, 0));
  it("requires the WebVTT signature", () => assert.throws(() => parseVtt("00:00:01.000 --> 00:00:02.000\nx", "m")));
  it("rejects streaming timestamp maps rather than silently applying wrong times", () => assert.throws(() => parseVtt("WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000\n\n00:01.000 --> 00:02.000\nx", "m"), /timestamp.map/i));
  for (const stamp of ["-1:00:01,000", "00:60:00,000", "00:00:60,000", "0e1:00:01,000", "00:00:01,0009"]) {
    it(`rejects malformed SRT timestamp ${stamp}`, () => assert.throws(() => parseSrt(`1\n${stamp} --> 01:00:01,000\nx`, "m")));
  }
  it("rejects empty asset identities", () => assert.throws(() => parseSrt("1\n00:00:01,000 --> 00:00:02,000\nx", "")));
  it("keeps user whitespace and CJK text", () => {
    const text = "  내 말  \n日本語。";
    const t = parseSrt(`\uFEFF1\r\n00:00:01,250 --> 00:00:03,000\r\n${text.replace(/\n/g,"\r\n")}\r\n`, "m");
    assert.equal(t.segments[0].text, text);
    assert.equal(parseSrt(toSrt(t), "m").segments[0].text, text);
  });
  it("quantizes the absolute end only once", () => {
    const t = parseSrt("1\n00:00:01,000 --> 00:00:02,000\nx", "m");
    t.segments[0].range = { start: { ticks: 10008n, timebase: { numerator: 1, denominator: 10000 } }, duration: { ticks: 10008n, timebase: { numerator: 1, denominator: 10000 } } };
    assert.match(toSrt(t), /00:00:01,000 --> 00:00:02,001/);
  });
  it("never coerces large bigint times through Number", () => {
    const t = parseSrt("1\n00:00:01,000 --> 00:00:02,000\nx", "m");
    t.segments[0].range.start.ticks = 9007199254740993n;
    assert.equal(parseSrt(toSrt(t), "m").segments[0].range.start.ticks, 9007199254740993n);
  });
  it("rejects negative export times", () => {
    const t = parseSrt("1\n00:00:01,000 --> 00:00:02,000\nx", "m");
    t.segments[0].range.start.ticks = -1n;
    assert.throws(() => toVtt(t));
  });
  it("does not export multiple source clocks as one subtitle timeline", () => {
    const a = parseSrt("1\n00:00:01,000 --> 00:00:02,000\na", "a");
    a.segments.push(...parseSrt("1\n00:00:01,000 --> 00:00:02,000\nb", "b").segments);
    assert.throws(() => toSrt(a), /asset|timeline/i);
  });
  it("does not emit zero duration subtitles after quantization", () => {
    const t = parseSrt("1\n00:00:01,000 --> 00:00:02,000\nx", "m");
    t.segments[0].range.duration = { ticks: 1n, timebase: { numerator: 1, denominator: 1000000 } };
    assert.throws(() => toSrt(t), /duration|millisecond/i);
  });
  it("rejects backwards WebVTT cue ordering without rearranging source text", () => {
    assert.throws(() => parseVtt("WEBVTT\n\n00:03.000 --> 00:04.000\nlater\n\n00:01.000 --> 00:02.000\nearlier", "m"), /order/i);
  });
  it("does not emit invalid WebVTT ordering from an edited canonical transcript", () => {
    const t = parseSrt("1\n00:00:03,000 --> 00:00:04,000\nlater\n\n2\n00:00:01,000 --> 00:00:02,000\nearlier", "m");
    assert.throws(() => toVtt(t), /order/i);
  });
  it("keeps the original SRT/VTT round-trip behavior", () => {
    const t = parseSrt("1\n00:00:01,250 --> 00:00:03,000\nhello\nworld\n", "m");
    assert.equal(parseVtt(toVtt(t), "m").segments[0].range.duration.ticks, 1750n);
    assert.match(toSrt(t), /00:00:01,250 --> 00:00:03,000/);
  });
});
