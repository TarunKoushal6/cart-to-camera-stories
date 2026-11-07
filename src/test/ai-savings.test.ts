import { describe, expect, it } from "vitest";
import { condenseTranscript, stripFiller, withinKept } from "@/lib/transcript-condense";
import { compactTranscript, parseAiSegments } from "@/lib/studio-rules";
import { clipMusic } from "@/lib/cloud-clipper-rules";

/** ~3 hours of word cues: mostly flat talk, with a few punchy sections. */
function longTalk() {
  const cues = [];
  for (let t = 0; t < 3 * 3600; t += 0.5) {
    const hot = Math.floor(t / 600) % 3 === 0 && t % 600 < 30;
    const word = hot ? (Math.floor(t * 2) % 7 === 0 ? "secret?" : "biggest") : Math.floor(t * 2) % 15 === 14 ? "okay." : "so";
    cues.push({ start: t, end: t + 0.4, text: word });
  }
  return cues;
}

describe("transcript condensing for AI moment selection", () => {
  it("cuts a 3-hour transcript sent to the AI by at least 70%", () => {
    const cues = longTalk();
    const r = condenseTranscript(cues);
    expect(r.filtered).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(compactTranscript(cues).length * 0.3);
  });

  it("keeps the high-energy sections", () => {
    const r = condenseTranscript(longTalk());
    expect(r.kept.some(k => k.start <= 1800 && k.end >= 1800)).toBe(true);
  });

  it("does not filter short transcripts, only removes filler", () => {
    const cues = [{ start: 0, end: 1, text: "um so" }, { start: 1, end: 2, text: "you know this works." }];
    const r = condenseTranscript(cues);
    expect(r.filtered).toBe(false);
    expect(r.text).toBe("[00:00] so this works.");
  });

  it("provides a full minute of context for longer complete thoughts", () => {
    const r = condenseTranscript(Array.from({ length: 240 }, (_, start) => ({ start, end: start + 1, text: "secret" })), { minWords: 1, buckets: 1 });
    expect(r.kept.some(k => k.end - k.start >= 60)).toBe(true);
  });

  it("removes filler words and stutters", () => {
    expect(stripFiller("um the the truth is, you know, simple")).toBe("the truth is, simple");
  });

  it("drops AI clips outside the excerpt the AI was shown", () => {
    const segs = [{ start: 100, end: 125 }, { start: 5000, end: 5025 }];
    expect(withinKept(segs, [{ start: 90, end: 140 }])).toEqual([{ start: 100, end: 125 }]);
  });
});

describe("background music", () => {
  it("auto uses the clip's AI mood", () => { expect(clipMusic("auto", "chill")).toBe("chill"); });
  it("auto falls back to inspiring when the AI gave no mood", () => { expect(clipMusic("auto", undefined)).toBe("inspiring"); });
  it("off means no music", () => { expect(clipMusic("off", "energetic")).toBeNull(); });
  it("a chosen mood applies to every clip", () => { expect(clipMusic("dramatic", "funny")).toBe("dramatic"); });
  it("an unknown AI mood keeps the clip and drops the mood", () => {
    const [s] = parseAiSegments(JSON.stringify({ segments: [{ title: "a", start: 0, end: 25, score: 80, reason: "r", vibe: "spooky" }] }), 100);
    expect(s?.vibe).toBeUndefined();
  });
});
