import { segmentSchema, providerBaseUrl, type Provider, type Cue } from "./studio-rules";
import { z } from "zod";

/** Lists the models a key can use, so the settings page can offer a dropdown. */
export async function fetchModels(provider: Provider, key: string, baseUrl?: string | null): Promise<string[]> {
  let endpoint: string, headers: Record<string, string>;
  if (provider === "gemini") {
    endpoint = "https://generativelanguage.googleapis.com/v1beta/models";
    headers = { "x-goog-api-key": key };
  } else if (provider === "anthropic") {
    endpoint = "https://api.anthropic.com/v1/models";
    headers = { "x-api-key": key, "anthropic-version": "2023-06-01" };
  } else {
    endpoint = `${providerBaseUrl(provider, baseUrl)}/models`;
    headers = { Authorization: `Bearer ${key}` };
  }
  const r = await fetch(endpoint, { headers, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${provider} rejected the key (${r.status}). Check the key, base URL and billing.`);
  const result = await r.json() as { data?: { id?: string }[]; models?: { name?: string; supportedGenerationMethods?: string[] }[] };
  let ids: string[] = [];
  if (provider === "gemini") {
    ids = (result.models || []).filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent")).map(m => (m.name || "").replace(/^models\//, ""));
  } else {
    ids = (result.data || []).map(m => m.id || "");
  }
  ids = [...new Set(ids.filter(Boolean))].sort();
  if (!ids.length) throw new Error("The endpoint returned no models.");
  return ids;
}

export async function analyzeWithKey(provider: Provider, model: string, key: string, cues: Cue[], baseUrl?: string | null) {
  const prompt = `Find up to 6 high-retention, self-contained viral hooks in this transcript. Each segment MUST be 20–30 seconds, within the transcript timestamps. Do not invent words or times. Score potential 0–100, not a guaranteed prediction. Return ONLY JSON: {"segments":[{"title":"...","start":0,"end":25,"score":85,"reason":"..."}]}. Transcript: ${JSON.stringify(cues)}`;
  let endpoint: string, headers: Record<string,string>, body: object;
  if (provider === "gemini") {
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    headers = { "Content-Type": "application/json", "x-goog-api-key": key };
    body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } };
  } else if (provider === "anthropic") {
    endpoint = "https://api.anthropic.com/v1/messages";
    headers = { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" };
    body = { model, max_tokens: 3000, messages: [{ role: "user", content: prompt }] };
  } else {
    endpoint = `${providerBaseUrl(provider, baseUrl)}/chat/completions`;
    headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
    body = { model, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" } };
  }
  const r = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  // Do not include provider bodies: some services can echo credentials in errors.
  if (!r.ok) throw new Error(`${provider} rejected the analysis (${r.status}). Check your key, model, quota and billing in Settings.`);
  const result = await r.json() as { choices?: { message: { content: string } }[]; content?: { text?: string }[]; candidates?: { content: { parts: { text?: string }[] } }[] };
  const text = result.choices?.[0]?.message.content ?? result.content?.map(c=>c.text || "").join("") ?? result.candidates?.[0]?.content.parts.map(p=>p.text || "").join("");
  if (!text) throw new Error("The provider returned no segments.");
  const parsed = z.object({ segments: z.array(segmentSchema).min(1).max(6) }).parse(JSON.parse(text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")));
  const last = Math.max(...cues.map(c=>c.end));
  if (parsed.segments.some(s => s.end > last)) throw new Error("The provider returned a segment outside the transcript. Try again.");
  return parsed.segments;
}

/** Writes a caption and spoken voiceover script for one clip from its transcript window. */
export async function writeClipText(provider: Provider, model: string, key: string, baseUrl: string | null | undefined, title: string, cues: Cue[]) {
  const transcript = cues.map(c => c.text).join(" ").slice(0, 6000);
  const prompt = `You write short-video copy. For the clip titled "${title}", using this transcript excerpt, return ONLY JSON: {"caption":"social caption with 3-6 hashtags, max 300 chars","voiceover":"a natural spoken voiceover script of 40-70 words matching the clip language"}. Transcript: ${transcript}`;
  let endpoint: string, headers: Record<string, string>, body: object;
  if (provider === "gemini") {
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    headers = { "Content-Type": "application/json", "x-goog-api-key": key };
    body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } };
  } else if (provider === "anthropic") {
    endpoint = "https://api.anthropic.com/v1/messages";
    headers = { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" };
    body = { model, max_tokens: 1200, messages: [{ role: "user", content: prompt }] };
  } else {
    endpoint = `${providerBaseUrl(provider, baseUrl)}/chat/completions`;
    headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
    body = { model, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" } };
  }
  const r = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  if (!r.ok) throw new Error(`${provider} rejected the request (${r.status}). Check your key and model in Settings.`);
  const result = await r.json() as { choices?: { message: { content: string } }[]; content?: { text?: string }[]; candidates?: { content: { parts: { text?: string }[] } }[] };
  const text = result.choices?.[0]?.message.content ?? result.content?.map(c=>c.text || "").join("") ?? result.candidates?.[0]?.content.parts.map(p=>p.text || "").join("");
  if (!text) throw new Error("The provider returned no text.");
  return z.object({ caption: z.string().min(1).max(2200), voiceover: z.string().min(1).max(4000) }).parse(JSON.parse(text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")));
}
