import { describe, it, expect } from "vitest";
import { detectSource } from "@/lib/ugc-rules";

describe("detectSource", () => {
  it("accepts Amazon links", () => {
    expect(detectSource("https://www.amazon.in/dp/B0ABC")).toBe("amazon");
    expect(detectSource("https://amzn.in/d/xyz")).toBe("amazon");
  });
  it("accepts Flipkart links", () => {
    expect(detectSource("https://www.flipkart.com/item/p/itm123")).toBe("flipkart");
  });
  it("rejects other stores", () => {
    expect(detectSource("https://www.myntra.com/x")).toBe("other");
    expect(detectSource("https://notamazon.com.evil.io/x")).toBe("other");
  });
});
