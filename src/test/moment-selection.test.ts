import { describe, expect, it } from "vitest";
import { evidencedMoments, mergeMoments, momentBatches } from "@/lib/moment-selection";
import { withinKept } from "@/lib/transcript-condense";
import { parseAiSegments } from "@/lib/studio-rules";
import { MUSIC_VOLUME } from "@/lib/cloud-clipper-rules";

const moment = (start: number, length: number, score = 80) => ({ start, end: start + length, score, title: `Topic ${start}`, reason: "Complete thought", vibe: "chill" as const });
describe("topic-led moment selection", () => {
  it("retains exact 20, 23, 47 and 60 second topic lengths without padding", () => {
    const moments = [moment(0, 20), moment(100, 23), moment(200, 47), moment(300, 60)];
    expect(mergeMoments(moments).map(s => s.end - s.start)).toEqual([20, 23, 47, 60]);
  });
  it("can retain more than four or fifteen distinct reels from a two-hour video", () => {
    expect(mergeMoments(Array.from({ length: 32 }, (_, i) => moment(i * 210, 20 + i))).length).toBe(32);
  });
  it("deduplicates competing versions without preferring the longest clip", () => {
    expect(mergeMoments([moment(10, 23, 90), moment(8, 60, 70)])).toEqual([moment(10, 23, 90)]);
  });
  it("examines every part of a two-hour transcript in bounded reads", () => {
    const batches = momentBatches(Array.from({ length: 14400 }, (_, i) => ({ start: i / 2, end: i / 2 + 0.5, text: i % 9 ? "conversation" : "why?" })));
    expect(batches).toHaveLength(8);
    expect(batches[0]?.start).toBe(0);
    expect(batches.at(-1)?.end).toBe(7200);
    expect(batches.every(b => b.text.length < 25000)).toBe(true);
  });
  it("never keeps an unseen payoff or falls back to hallucinated windows", () => {
    expect(withinKept([moment(100, 60), moment(5000, 25)], [{ start: 90, end: 140 }])).toEqual([]);
  });
  it("keeps setup/payoff context around selected windows without sending the raw long transcript", () => {
    const cues = Array.from({ length: 14400 }, (_, i) => ({ start: i / 2, end: i / 2 + 0.5, text: i % 9 ? "conversation" : "why?" }));
    const batches = momentBatches(cues);
    expect(batches.some(b => b.kept.some(k => k.end - k.start > 110))).toBe(true);
    expect(batches.reduce((n, b) => n + b.text.length, 0)).toBeLessThan(cues.map(c => c.text).join(" ").length * 0.6);
  });
  it("filters overlap context to the batch that owns the start", () => {
    const batch = { start: 0, end: 900, text: "", kept: [{ start: 850, end: 920 }], originalChars: 0, condensedChars: 0, filtered: true };
    expect(evidencedMoments([moment(890, 20), moment(900, 20)], batch)).toEqual([moment(890, 20)]);
  });
  it("allows an empty weak-topic response without inventing filler clips", () => {
    expect(parseAiSegments('{"segments":[]}', 7200, true)).toEqual([]);
  });
  it("accepts intentional no-music mood", () => {
    expect(parseAiSegments(JSON.stringify({ segments: [{ ...moment(0, 23), vibe: "none" }] }), 60)[0]?.vibe).toBe("none");
  });
  it("keeps music at ten percent before further speech ducking", () => { expect(MUSIC_VOLUME).toBe(0.10); });
});