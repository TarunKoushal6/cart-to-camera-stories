import { segmentSchema, type Provider, type Cue } from "./studio-rules";
import { z } from "zod";

export async function analyzeWithKey(provider: Provider, model: string, key: string, cues: Cue[]) {
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
    endpoint = provider === "openrouter" ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
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