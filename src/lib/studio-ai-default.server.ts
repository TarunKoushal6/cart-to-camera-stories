import { z } from "zod";
import { providers, type Provider } from "./studio-rules";

/** Built-in default for accounts without a working personal AI key: Lovable AI's low-cost model
 * through the OpenAI-compatible chat-completions endpoint, authenticated with the server-only LOVABLE_API_KEY. */
export const DEFAULT_AI = { provider: "custom" as Provider, model: "google/gemini-2.5-flash-lite", baseUrl: "https://ai.gateway.lovable.dev/v1" };

export type AiCredential = { provider: Provider; model: string; key: string; baseUrl: string | null; shared: boolean };
type Saved = { provider: string; model: string | null; base_url: string | null; encrypted_key: string } | null | undefined;

/** Carries the provider HTTP status so callers can decide whether another key should be tried. */
export class AiRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** A personal key falls back when the provider refused it (bad key, no credit, rate-limited) or is down (5xx). */
export function savedKeyUnusable(e: unknown) {
  return e instanceof AiRequestError && ([401, 402, 403, 429].includes(e.status) || e.status >= 500);
}

/** The built-in Lovable AI credential, available whenever LOVABLE_API_KEY is configured on the server. */
export function sharedAiCredentials(env: Record<string, string | undefined> = process.env): AiCredential[] {
  const key = env["LOVABLE_API_KEY"];
  return key ? [{ provider: DEFAULT_AI.provider, model: DEFAULT_AI.model, key, baseUrl: DEFAULT_AI.baseUrl, shared: true }] : [];
}

/** Turns built-in AI failures into messages that name the fix instead of a bare status code. */
export function explainDefaultAiError(e: unknown): unknown {
  if (!(e instanceof AiRequestError)) return e;
  if (e.status === 402) return new AiRequestError("The built-in AI has run out of credits. Add credits to the workspace, or save your own AI key in Settings.", 402);
  if (e.status === 429) return new AiRequestError("The built-in AI is busy right now (rate limited). Wait a minute and try again.", 429);
  if (e.status === 401) return new AiRequestError("The built-in AI isn't configured correctly. Save your own AI key in Settings meanwhile.", 401);
  return e;
}

/** Runs an AI call with the owner's saved key, falling back to the built-in Lovable AI when no personal key is saved,
 * it can't be decrypted, or the provider refused it (401/402/403/429) or is down (5xx). */
export async function withAi<T>(saved: Saved, secret: string, run: (c: AiCredential) => Promise<T>): Promise<T> {
  const shared = sharedAiCredentials();
  if (saved?.model) {
    let own: AiCredential | null = null;
    try {
      const { decrypt } = await import("./studio-crypto.server");
      own = { provider: z.enum(providers).parse(saved.provider), model: saved.model, key: await decrypt(saved.encrypted_key, secret), baseUrl: saved.base_url, shared: false };
    } catch (e) { if (!shared.length) throw e; }
    if (own) {
      try { return await run(own); } catch (e) { if (!shared.length || !savedKeyUnusable(e)) throw e; }
    }
  }
  if (!shared.length) throw new Error("Save your AI endpoint, key and model in Settings first.");
  let first: unknown;
  for (const c of shared) {
    try { return await run(c); } catch (e) { first ??= explainDefaultAiError(e); }
  }
  throw first;
}
