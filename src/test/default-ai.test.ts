import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { withAi, AiRequestError, DEFAULT_AI } from "@/lib/studio-ai-default.server";
import { encrypt } from "@/lib/studio-crypto.server";

const SECRET = "test-secret-test-secret-test-secret";
describe("built-in default AI (Lovable AI)", () => {
  const env = { ...process.env };
  beforeEach(() => { process.env["LOVABLE_API_KEY"] = "lovable"; });
  afterEach(() => { process.env = { ...env }; });

  it("uses Lovable AI with gemini-3.1-flash-lite when no personal key is saved", async () => {
    const used = await withAi(null, SECRET, async c => c);
    expect(used).toMatchObject({ key: "lovable", model: "google/gemini-3.1-flash-lite", baseUrl: "https://ai.gateway.lovable.dev/v1", shared: true });
    expect(DEFAULT_AI.provider).toBe("custom");
  });

  it("falls back from a revoked personal key to Lovable AI", async () => {
    const saved = { provider: "openai", model: "gpt-x", base_url: null, encrypted_key: await encrypt("mine", SECRET) };
    const keys: string[] = [];
    const out = await withAi(saved, SECRET, async c => { keys.push(c.key); if (c.key === "mine") throw new AiRequestError("revoked", 401); return c.key; });
    expect(out).toBe("lovable"); expect(keys).toEqual(["mine", "lovable"]);
  });

  it("keeps a working personal key and does not use Lovable AI", async () => {
    const saved = { provider: "openai", model: "gpt-x", base_url: null, encrypted_key: await encrypt("mine", SECRET) };
    expect(await withAi(saved, SECRET, async c => c.key)).toBe("mine");
  });

  it("does not switch keys for a personal-key error unrelated to the key", async () => {
    const saved = { provider: "openai", model: "gpt-x", base_url: null, encrypted_key: await encrypt("mine", SECRET) };
    await expect(withAi(saved, SECRET, async () => { throw new AiRequestError("bad model", 400); })).rejects.toThrow("bad model");
  });

  it("explains when the built-in AI runs out of credits", async () => {
    await expect(withAi(null, SECRET, async () => { throw new AiRequestError("x", 402); })).rejects.toThrow(/run out of credits/);
  });

  it("uses Lovable AI when the saved personal key cannot be decrypted", async () => {
    const saved = { provider: "openai", model: "gpt-x", base_url: null, encrypted_key: "corrupt" };
    expect(await withAi(saved, SECRET, async c => c.key)).toBe("lovable");
  });

  it("asks for a personal key when no built-in key is configured", async () => {
    delete process.env["LOVABLE_API_KEY"];
    await expect(withAi(null, SECRET, async c => c)).rejects.toThrow(/Settings/);
  });
});
