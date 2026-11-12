import { describe, it, expect } from "vitest";
import { dueSlotKey, normalizeSlots, pickRandom } from "@/lib/buffer-rules";

describe("buffer auto-post slots", () => {
  it("fires at 12:00 IST (06:30 UTC)", () => {
    expect(dueSlotKey(["12:00"], "Asia/Kolkata", new Date("2026-11-12T06:35:00Z"), null)).toBe("2026-11-12 12:00");
  });
  it("does not fire the same slot twice", () => {
    expect(dueSlotKey(["12:00"], "Asia/Kolkata", new Date("2026-11-12T06:40:00Z"), "2026-11-12 12:00")).toBeNull();
  });
  it("does not fire before the slot or after 30 minutes", () => {
    expect(dueSlotKey(["12:00"], "Asia/Kolkata", new Date("2026-11-12T06:25:00Z"), null)).toBeNull();
    expect(dueSlotKey(["12:00"], "Asia/Kolkata", new Date("2026-11-12T07:01:00Z"), null)).toBeNull();
  });
  it("drops invalid and duplicate times", () => {
    expect(normalizeSlots(["20:30", "25:00", "12:00", "12:00"])).toEqual(["12:00", "20:30"]);
  });
  it("picks one reel from the pool", () => {
    expect(pickRandom(["a", "b", "c"], () => 0.5)).toBe("b");
    expect(pickRandom([], () => 0.5)).toBeNull();
  });
});
