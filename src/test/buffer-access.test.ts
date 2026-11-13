import { describe, it, expect } from "vitest";
import { wantsBuffer } from "@/lib/cloud-clipper-rules";

describe("Buffer auto-post access", () => {
  it("allows koushaltarun5@gmail.com", () => expect(wantsBuffer(" KoushalTarun5@gmail.com ")).toBe(true));
  it("blocks every other account", () => expect(wantsBuffer("kumarishakti722@gmail.com")).toBe(false));
});
