import { describe, expect, it } from "vitest";
import { captionTimeline } from "@/lib/caption-timeline";

describe("single caption timeline", () => {
  it("merges the saved clip's overlapping I and SEE cues", () => {
    const result = captionTimeline([
      { start: 1351.566, end: 1352.097, text: "I" },
      { start: 1352.04, end: 1352.538, text: "I" },
      { start: 1352.097, end: 1352.629, text: "SEE" },
      { start: 1352.538, end: 1353.036, text: "SEE" },
      { start: 1352.629, end: 1353.16, text: "IT!" },
    ]);
    expect(result.map(w => w.text)).toEqual(["I", "SEE", "IT!"]);
    expect(result.every((w, i) => !result[i + 1] || w.end <= (result[i + 1]?.start ?? 0))).toBe(true);
  });
  it("preserves sequential repeated speech and Hindi words", () => {
    expect(captionTimeline([{ start: 0, end: 1, text: "नहीं" }, { start: 1, end: 2, text: "नहीं" }]).map(w => w.text)).toEqual(["नहीं", "नहीं"]);
  });
});