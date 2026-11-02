import { z } from "zod";

export const providers = ["openai", "gemini", "openrouter", "anthropic", "custom"] as const;
export type Provider = typeof providers[number];
export const endpointSchema = z.string().url().max(500).regex(/^https?:\/\//, "Use an http(s) URL.");
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
/** Background-music moods the AI may tag a clip with; the worker matches a royalty-free bed to it. */
export const VIBES = ["energetic", "chill", "emotional", "dramatic", "inspiring", "funny"] as const;
export type Vibe = typeof VIBES[number];
export const CLIP_MIN_SECONDS = 20, CLIP_MAX_SECONDS = 60;
export const segmentSchema = z.object({ title: z.string().min(1).max(200), start: z.number().min(0), end: z.number(), score: z.number().int().min(0).max(100), reason: z.string().max(1000), vibe: z.enum(VIBES).optional() }).refine(s => s.end - s.start >= CLIP_MIN_SECONDS && s.end - s.start <= CLIP_MAX_SECONDS, `Clips must be ${CLIP_MIN_SECONDS}–${CLIP_MAX_SECONDS} seconds long.`);
/**
 * Reads AI segment JSON, tolerating code fences, a response cut off mid-way, and individual bad items.
 * Keeps every complete, valid segment that ends by `lastSecond`, up to 15.
 */
export function parseAiSegments(text: string, lastSecond: number) {
  const clean = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  let items: unknown[] = [];
  try {
    const j = JSON.parse(clean) as { segments?: unknown[] } | unknown[];
    items = Array.isArray(j) ? j : Array.isArray(j?.segments) ? j.segments : [];
  } catch {
    // Truncated output: salvage each complete flat {...} object.
    for (const m of clean.matchAll(/\{[^{}]*\}/g)) { try { items.push(JSON.parse(m[0])); } catch { /* incomplete */ } }
  }
  const out: z.infer<typeof segmentSchema>[] = [];
  for (const raw of items) {
    const r = raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : raw;
    if (r && typeof r === "object" && typeof (r as { score?: unknown }).score === "number") (r as { score: number }).score = Math.round((r as { score: number }).score);
    // An unknown mood must not discard an otherwise good clip.
    if (r && typeof r === "object") { const o = r as { vibe?: unknown }; const v = typeof o.vibe === "string" ? o.vibe.toLowerCase().trim() : undefined; if (v && (VIBES as readonly string[]).includes(v)) o.vibe = v; else delete o.vibe; }
    const s = segmentSchema.safeParse(r);
    if (s.success && s.data.end <= lastSecond) out.push(s.data);
    if (out.length === 15) break;
  }
  if (!out.length) throw new Error(`The AI returned no usable ${CLIP_MIN_SECONDS}–${CLIP_MAX_SECONDS} second clips. Try again.`);
  return out;
}
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
/** Last cue end; loop instead of Math.max(...) so 75k-word transcripts don't overflow the call stack. */
export function transcriptEnd(cues: Cue[]) {
  let end = 0;
  for (const c of cues) if (c.end > end) end = c.end;
  return end;
}
export function formatStamp(seconds: number) {
  const t = Math.floor(seconds), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
/** Compact "[MM:SS] sentence" lines for AI analysis: breaks at sentence ends, pauses over 1.5s or ~8s of speech. */
export function compactTranscript(cues: Cue[], maxLineSeconds = 8) {
  const lines: string[] = [];
  let start = 0, words: string[] = [], lastEnd = 0;
  const flush = () => { if (words.length) lines.push(`[${formatStamp(start)}] ${words.join(" ")}`); words = []; };
  for (const c of cues) {
    const text = c.text.trim();
    if (!text) continue;
    if (words.length && (c.start - lastEnd > 1.5 || c.start - start >= maxLineSeconds)) flush();
    if (!words.length) start = c.start;
    words.push(text);
    lastEnd = c.end;
    if (/[.!?।]["')\]]*$/.test(text)) flush();
  }
  flush();
  return lines.join("\n");
}
export function clipCues(cues: Cue[], start: number, end: number): Cue[] {
  return cues.filter(c => c.end > start && c.start < end).map(c => ({ ...c, start: Math.max(0, c.start-start), end: Math.min(end-start,c.end-start) }));
}
export function stamp(seconds: number) { return `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,"0")}`; }
export function studioHead(title: string, description: string) { return { meta: [{ title: `${title} — Cutline` }, { name: "description", content: description }, { property: "og:title", content: `${title} — Cutline` }, { property: "og:description", content: description }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }; }/** Next-day posting slots in local time: first at startHour, then every gapHours, wrapping within the day. */
export function nextDaySlots(count: number, now = new Date(), startHour = 10, gapHours = 2) {
  const gapMinutes = count > 1 ? Math.min(gapHours * 60, Math.floor((24 * 60 - 1 - startHour * 60) / (count - 1))) : gapHours * 60;
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now); d.setDate(d.getDate() + 1);
    const minutes = startHour * 60 + i * gapMinutes;
    d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return d;
  });
}
