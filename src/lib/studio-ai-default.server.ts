import { z } from "zod";
import { providers, type Provider } from "./studio-rules";

/** Shared fallback endpoint for accounts without a working personal AI key. Keys live in server secrets. */
export const DEFAULT_AI = { provider: "custom" as Provider, model: "qwen3.8-flash", baseUrl: "https://api.iceyyy.dev/v1" };

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

/** The hermes key (stored as DEFAULT_AI_KEY_BACKUP) is the primary active shared key; DEFAULT_AI_KEY is the fallback. */
export function sharedAiCredentials(env: Record<string, string | undefined> = process.env): AiCredential[] {
  return [...new Set([env["DEFAULT_AI_KEY_BACKUP"], env["DEFAULT_AI_KEY"]].filter((k): k is string => !!k))]
    .map(key => ({ provider: DEFAULT_AI.provider, model: DEFAULT_AI.model, key, baseUrl: DEFAULT_AI.baseUrl, shared: true }));
}

/** Runs an AI call with the owner's saved key, then the hermes shared key, then the other shared key.
 * A refused (401/402/403/429) or undecryptable personal key never surfaces; if every shared key fails,
 * the active (first) shared key's error is reported, not the personal key's or the stale fallback's. */
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
    try { return await run(c); } catch (e) { first ??= e; }
  }
  throw first;
}
