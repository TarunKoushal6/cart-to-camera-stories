import { z } from "zod";

export const providers = ["openai", "gemini", "openrouter", "anthropic", "custom"] as const;
export type Provider = typeof providers[number];
export const endpointSchema = z.url({ protocol: /^https?$/ }).max(500);
/** Chat-completions base URL for a provider; custom endpoints must supply their own. */
export function providerBaseUrl(provider: Provider, baseUrl?: string | null) {
  if (provider === "openai") return "https://api.openai.com/v1";
  if (provider === "openrouter") return "https://openrouter.ai/api/v1";
  if (provider === "custom") {
    const parsed = endpointSchema.safeParse((baseUrl || "").trim().replace(/\/+$/, ""));
    if (!parsed.success) throw new Error("Enter a valid base URL for your custom endpoint (e.g. https://api.example.com/v1).");
    return parsed.data;
  }
  return null;
}
export type Cue = { start: number; end: number; text: string };
export const cueSchema = z.object({ start: z.number().min(0), end: z.number().min(0), text: z.string().min(1).max(4000) }).refine(c => c.end > c.start);
export const segmentSchema = z.object({ title: z.string().min(1).max(200), start: z.number().min(0), end: z.number(), score: z.number().int().min(0).max(100), reason: z.string().max(1000) }).refine(s => s.end - s.start >= 20 && s.end - s.start <= 30, "Clips must be 20–30 seconds long.");
export function youtubeId(value: string) {
  let u: URL;
  try { u = new URL(value); } catch { throw new Error("Enter a YouTube video URL."); }
  const host = u.hostname.replace(/^www\./, "");
  const id = host === "youtu.be" ? u.pathname.slice(1) : ["youtube.com", "m.youtube.com"].includes(host) ? (u.searchParams.get("v") || u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1]) : null;
  if (!id || !/^[\w-]{11}$/.test(id)) throw new Error("Enter a valid YouTube video URL.");
  return id;
}
export function parseTranscript(input: string): Cue[] {
  const time = (s: string) => s.replace(",", ".").split(":").reduce((n, v) => n * 60 + Number(v), 0);
  const blocks = input.replace(/\r/g, "").split(/\n\s*\n/);
  const cues: Cue[] = [];
  for (const b of blocks) {
    const lines = b.split("\n");
    const i = lines.findIndex(l => l.includes("-->"));
    if (i < 0) continue;
    const match = lines[i]?.match(/([\d:. ,]+)\s*-->\s*([\d:.,]+)/);
    if (!match?.[1] || !match[2]) continue;
    const text = lines.slice(i + 1).join(" ").replace(/<[^>]*>/g, "").trim();
    const cue = { start: time(match[1].trim()), end: time(match[2].trim()), text };
    if (cueSchema.safeParse(cue).success) cues.push(cue);
  }
  return cues.sort((a,b) => a.start-b.start);
}
export function clipCues(cues: Cue[], start: number, end: number): Cue[] {
  return cues.filter(c => c.end > start && c.start < end).map(c => ({ ...c, start: Math.max(0, c.start-start), end: Math.min(end-start,c.end-start) }));
}
export function stamp(seconds: number) { return `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,"0")}`; }
export function studioHead(title: string, description: string) { return { meta: [{ title: `${title} — Cutline` }, { name: "description", content: description }, { property: "og:title", content: `${title} — Cutline` }, { property: "og:description", content: description }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }; }