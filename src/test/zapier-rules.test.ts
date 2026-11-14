import { describe, it, expect } from "vitest";
import { dueSlotKey, normalizeSlots, pickRandom, wantsZapier, zapierWebhook, requireZapierConsent } from "@/lib/zapier-rules";

describe("Zapier access and consent", () => {
  it("allows only Tarun's email", () => {
    expect(wantsZapier(" KoushalTarun5@gmail.com ")).toBe(true);
    expect(wantsZapier("kumarishakti722@gmail.com")).toBe(false);
    expect(wantsZapier(undefined)).toBe(false);
  });
  it("requires approval before sending", () => {
    expect(() => requireZapierConsent(false)).toThrow();
    expect(() => requireZapierConsent(true)).not.toThrow();
  });
  it("accepts only Zapier Catch Hooks", () => {
    expect(zapierWebhook(" https://hooks.zapier.com/hooks/catch/123/example/ ")).toBe("https://hooks.zapier.com/hooks/catch/123/example/");
    for (const url of ["http://hooks.zapier.com/hooks/catch/123/example/", "https://example.com/", "https://hooks.zapier.com.evil.test/hooks/catch/123/example/", "https://hooks.zapier.com/hooks/catch/123/example/?secret=a"]) expect(() => zapierWebhook(url)).toThrow();
  });
});
describe("Zapier random daily sends", () => {
  it("fires at 12:00 IST", () => expect(dueSlotKey(["12:00"], "Asia/Kolkata", new Date("2026-11-14T06:35:00Z"), null)).toBe("2026-11-14 12:00"));
  it("never repeats a claimed slot", () => expect(dueSlotKey(["12:00"], "Asia/Kolkata", new Date("2026-11-14T06:40:00Z"), "2026-11-14 12:00")).toBeNull());
  it("doesn't fire before a time or beyond its window", () => {
    expect(dueSlotKey(["12:00"], "Asia/Kolkata", new Date("2026-11-14T06:25:00Z"), null)).toBeNull();
    expect(dueSlotKey(["12:00"], "Asia/Kolkata", new Date("2026-11-14T07:00:00Z"), null)).toBeNull();
  });
  it("doesn't oscillate between close slots", () => {
    expect(dueSlotKey(["12:00", "12:05"], "Asia/Kolkata", new Date("2026-11-14T06:40:00Z"), "2026-11-14 12:00")).toBe("2026-11-14 12:05");
    expect(dueSlotKey(["12:00", "12:05"], "Asia/Kolkata", new Date("2026-11-14T06:45:00Z"), "2026-11-14 12:05")).toBeNull();
  });
  it("filters invalid duplicate times", () => expect(normalizeSlots(["20:30", "25:00", "12:00", "12:00"])).toEqual(["12:00", "20:30"]));
  it("selects exactly one reel", () => {
    expect(pickRandom(["a", "b", "c"], () => 0.5)).toBe("b");
    expect(pickRandom([], () => 0.5)).toBeNull();
  });
});