import { describe, expect, it } from "vitest";
import { evidencedMoments, mergeMoments, momentBatches, topicMap, topicContexts } from "@/lib/moment-selection";
import { withinKept } from "@/lib/transcript-condense";
import { parseAiSegments } from "@/lib/studio-rules";
import { MUSIC_VOLUME } from "@/lib/cloud-clipper-rules";

const moment = (start: number, length: number, score = 80) => ({ start, end: start + length, score, title: `Topic ${start}`, reason: "Complete thought", vibe: "chill" as const });
describe("topic-led moment selection", () => {
  it("keeps quiet hook-free topics represented throughout the discovery map", () => {
    const cues = Array.from({ length: 240 }, (_, i) => ({ start: i * 30, end: i * 30 + 20, text: `Quiet topic number ${i} explains an ordinary observation` }));
    const map = topicMap(cues, 0, 7200);
    expect(map).toContain("Quiet topic number 0");
    expect(map).toContain("Quiet topic number 120");
    expect(map).toContain("Quiet topic number 239");
  });
  it("rereads original setup and payoff with 20 second context and rejects out-of-batch topics", () => {
    const cues = [{ start: 80, end: 90, text: "Question setup" }, { start: 100, end: 140, text: "Complete answer" }, { start: 140, end: 160, text: "Payoff" }];
    const contexts = topicContexts(cues, [{ start: 100, end: 140 }, { start: 900, end: 1000 }], 0, 900);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.text).toContain("Question setup");
    expect(contexts[0]?.text).toContain("Payoff");
    expect(evidencedMoments([moment(90, 60), moment(140, 40)], contexts[0] ?? { start: 0, end: 0, kept: [], text: "", filtered: false, originalChars: 0, condensedChars: 0 })).toEqual([moment(90, 60)]);
  });
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
  it("keeps music at thirty percent before further speech ducking", () => { expect(MUSIC_VOLUME).toBe(0.30); });
});