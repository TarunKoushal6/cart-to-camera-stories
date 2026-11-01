import { describe, it, expect } from "vitest";
import { savedKeyUnusable, AiRequestError } from "@/lib/studio-ai-default.server";

describe("personal AI key fallback", () => {
  it("falls back to the shared AI when the personal endpoint returns 502", () => {
    expect(savedKeyUnusable(new AiRequestError("down", 502))).toBe(true);
  });
  it("does not fall back on a 400 bad request", () => {
    expect(savedKeyUnusable(new AiRequestError("bad", 400))).toBe(false);
  });
});
