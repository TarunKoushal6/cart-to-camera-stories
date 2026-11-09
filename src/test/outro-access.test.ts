import { describe, it, expect } from "vitest";
import { wantsOutro } from "@/lib/cloud-clipper-rules";

describe("branded outro access", () => {
  it("is enabled for koushaltarun5@gmail.com", () => expect(wantsOutro(" KoushalTarun5@gmail.com ")).toBe(true));
  it("is disabled for every other account", () => {
    expect(wantsOutro("someone@gmail.com")).toBe(false);
    expect(wantsOutro(null)).toBe(false);
  });
});
