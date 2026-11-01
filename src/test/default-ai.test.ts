import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { withAi, AiRequestError, DEFAULT_AI } from "@/lib/studio-ai-default.server";
import { encrypt } from "@/lib/studio-crypto.server";

const SECRET = "test-secret-test-secret-test-secret";
describe("shared default AI", () => {
  const env = { ...process.env };
  beforeEach(() => { process.env["DEFAULT_AI_KEY_BACKUP"] = "primary"; process.env["DEFAULT_AI_KEY"] = "backup"; });
  afterEach(() => { process.env = { ...env }; });

  it("uses the hermes key (DEFAULT_AI_KEY_BACKUP) first with qwen3.8-flash on iceyyy", async () => {
    const used = await withAi(null, SECRET, async c => c);
    expect(used).toMatchObject({ key: "primary", model: "qwen3.8-flash", baseUrl: "https://api.iceyyy.dev/v1", shared: true });
    expect(DEFAULT_AI.provider).toBe("custom");
  });

  it("falls back to the backup key when the primary fails", async () => {
    const keys: string[] = [];
    const out = await withAi(null, SECRET, async c => { keys.push(c.key); if (c.key === "primary") throw new Error("timeout"); return c.key; });
    expect(out).toBe("backup"); expect(keys).toEqual(["primary", "backup"]);
  });

  it("falls back from a revoked personal key to the shared key", async () => {
    const saved = { provider: "openai", model: "gpt-x", base_url: null, encrypted_key: await encrypt("mine", SECRET) };
    const keys: string[] = [];
    const out = await withAi(saved, SECRET, async c => { keys.push(c.key); if (c.key === "mine") throw new AiRequestError("revoked", 401); return c.key; });
    expect(out).toBe("primary"); expect(keys).toEqual(["mine", "primary"]);
  });

  it("keeps a working personal key and does not use the shared key", async () => {
    const saved = { provider: "openai", model: "gpt-x", base_url: null, encrypted_key: await encrypt("mine", SECRET) };
    expect(await withAi(saved, SECRET, async c => c.key)).toBe("mine");
  });

  it("does not switch keys for a personal-key error unrelated to the key", async () => {
    const saved = { provider: "openai", model: "gpt-x", base_url: null, encrypted_key: await encrypt("mine", SECRET) };
    await expect(withAi(saved, SECRET, async () => { throw new AiRequestError("bad model", 400); })).rejects.toThrow("bad model");
  });

  it("falls back from a 402 personal key to the hermes key without surfacing the 402", async () => {
    const saved = { provider: "openai", model: "gpt-x", base_url: null, encrypted_key: await encrypt("mine", SECRET) };
    const out = await withAi(saved, SECRET, async c => { if (c.key === "mine") throw new AiRequestError("no credit", 402); return c.key; });
    expect(out).toBe("primary");
  });

  it("reports the hermes key's error, not the stale fallback's 402, when every shared key fails", async () => {
    await expect(withAi(null, SECRET, async c => { throw new AiRequestError(c.key === "primary" ? "hermes timeout" : "stale 402", c.key === "primary" ? 504 : 402); })).rejects.toThrow("hermes timeout");
  });

  it("uses the shared key when the saved personal key cannot be decrypted", async () => {
    const saved = { provider: "openai", model: "gpt-x", base_url: null, encrypted_key: "corrupt" };
    expect(await withAi(saved, SECRET, async c => c.key)).toBe("primary");
  });
});
