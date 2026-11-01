import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/studio-ai-default.server", () => ({ AiRequestError: class extends Error {} }));
import { chatBody } from "@/lib/studio-ai.server";

describe("chatBody", () => {
  it("does not send strict JSON mode to custom endpoints (they return 502)", () => {
    expect(chatBody("custom", "gemini-2.5-flash", "hi", 8000)).not.toHaveProperty("response_format");
  });
  it("keeps strict JSON mode for OpenAI", () => {
    expect(chatBody("openai", "gpt", "hi", 4000)["response_format"]).toEqual({ type: "json_object" });
  });
});
