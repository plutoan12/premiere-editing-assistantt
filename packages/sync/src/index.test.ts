import {describe,it,expect} from "vitest"; import {chooseSyncStrategy,buildTimecodeSyncGroup} from "./index.js";
describe("sync engine",()=>{
 it("prefers exact timecode when every clip has compatible timecode",()=>expect(chooseSyncStrategy([{clipId:"a",timecodeTicks:10n},{clipId:"b",timecodeTicks:20n}])).toBe("timecode"));
 it("falls back to audio when timecode is incomplete but audio fingerprints exist",()=>expect(chooseSyncStrategy([{clipId:"a",audioFingerprint:"x"},{clipId:"b",audioFingerprint:"y"}])).toBe("audio"));
 it("requires manual review when no deterministic evidence exists",()=>expect(chooseSyncStrategy([{clipId:"a"},{clipId:"b"}])).toBe("manual"));
 it("normalizes timecode offsets against the earliest clip",()=>{const g=buildTimecodeSyncGroup("g1",[{clipId:"a",timecodeTicks:100n},{clipId:"b",timecodeTicks:125n}]); expect(g.members.map(x=>x.offsetTicks)).toEqual([0n,25n])});
});
