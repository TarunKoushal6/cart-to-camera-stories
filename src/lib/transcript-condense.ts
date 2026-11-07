import { formatStamp, type Cue } from "./studio-rules";

/** Spoken filler that adds tokens but no meaning. Removed before the AI reads the transcript. */
const FILLER = /\b(?:um+|uh+|uhh+|hmm+|erm|ah+|you know|i mean|sort of|kind of|basically|literally)\b,?\s*/gi;
/** Phrases that usually mark a quotable, high-retention moment (English + Hindi/Hinglish). */
const HOOK = /\b(?:secret|mistake|never|always|truth|why|how|nobody|everyone|most people|biggest|worst|best|actually|but|stop|crazy|shocking|million|crore|lakh|money|rich|fail(?:ed|ure)?|success|habit|brain|science|research|study|problem|fix|trick|hack|rule|kabhi|sach|galti|paisa|log|kyun|kaise|matlab)\b/gi;
/** Sponsor reads, housekeeping and outros rarely make good shorts. */
const LOW_VALUE = /\b(?:subscribe|sponsor(?:ed)?|link in (?:the )?description|use code|promo code|discount code|like and share|hit the bell|see you next|thanks for watching)\b/gi;

export type Phrase = { start: number; end: number; text: string };
export type CondenseResult = { text: string; kept: { start: number; end: number }[]; originalChars: number; condensedChars: number; filtered: boolean };

export function stripFiller(text: string) {
  return text.replace(FILLER, "").replace(/\b(\w+)(\s+\1\b)+/gi, "$1").replace(/\s{2,}/g, " ").trim();
}

/** Groups word/phrase cues into sentence-like phrases (breaks at sentence ends, pauses >1.5s or ~8s of speech). */
export function toPhrases(cues: Cue[], maxLineSeconds = 8): Phrase[] {
  const out: Phrase[] = [];
  let start = 0, end = 0, words: string[] = [];
  const flush = () => { if (words.length) out.push({ start, end, text: words.join(" ") }); words = []; };
  for (const c of cues) {
    const text = c.text.trim();
    if (!text) continue;
    if (words.length && (c.start - end > 1.5 || c.start - start >= maxLineSeconds)) flush();
    if (!words.length) start = c.start;
    words.push(text);
    end = c.end;
    if (/[.!?।]["')\]]*$/.test(text)) flush();
  }
  flush();
  return out;
}

type Window = { start: number; end: number; phrases: Phrase[]; score: number };

/** Energy score: speech density plus hook language, minus sponsor/outro housekeeping. */
export function windowScore(phrases: Phrase[]) {
  const text = phrases.map(p => p.text).join(" ");
  const words = text.split(/\s+/).filter(Boolean).length;
  const span = Math.max(1, (phrases.at(-1)?.end ?? 0) - (phrases[0]?.start ?? 0));
  const density = Math.min(4, words / span); // words per second, capped so fast mumbling can't dominate
  const hooks = (text.match(HOOK) || []).length, questions = (text.match(/\?/g) || []).length;
  const exclaims = (text.match(/!/g) || []).length, numbers = (text.match(/\b\d+(?:[.,]\d+)?%?/g) || []).length;
  const low = (text.match(LOW_VALUE) || []).length;
  const per100 = 100 / Math.max(20, words);
  return density * 1.5 + (hooks * 1 + questions * 2 + exclaims * 1.5 + numbers * 1.2) * per100 - low * 6;
}

/**
 * Condenses a transcript for moment selection: removes filler, scores ~60s windows by energy,
 * and keeps only the strongest windows (spread across the whole video) in chronological order.
 * Short transcripts are only cleaned, never filtered.
 */
export function condenseTranscript(cues: Cue[], opts: { windowSeconds?: number; keepRatio?: number; minWords?: number; buckets?: number; contextSeconds?: number } = {}): CondenseResult {
  const windowSeconds = opts.windowSeconds ?? 60, keepRatio = opts.keepRatio ?? 0.2, minWords = opts.minWords ?? 3000, buckets = opts.buckets ?? 12;
  const phrases = toPhrases(cues);
  const originalChars = phrases.reduce((n, p) => n + p.text.length + 14, 0);
  const cleaned = phrases.map(p => ({ ...p, text: stripFiller(p.text) })).filter(p => p.text.length > 1);
  const line = (p: Phrase) => `[${formatStamp(p.start)}] ${p.text}`;
  const all = { start: cleaned[0]?.start ?? 0, end: cleaned.at(-1)?.end ?? 0 };
  if (cues.length < minWords) {
    const text = cleaned.map(line).join("\n");
    return { text, kept: cleaned.length ? [all] : [], originalChars, condensedChars: text.length, filtered: false };
  }
  const windows: Window[] = [];
  for (const p of cleaned) {
    const w = windows.at(-1);
    if (w && p.start - w.start < windowSeconds) { w.phrases.push(p); w.end = p.end; }
    else windows.push({ start: p.start, end: p.end, phrases: [p], score: 0 });
  }
  for (const w of windows) w.score = windowScore(w.phrases);
  const keepCount = Math.max(buckets, Math.round(windows.length * keepRatio));
  const keep = new Set<Window>();
  // Coverage first: the best window of each part of the video, so one hot section can't crowd out the rest.
  const duration = Math.max(1, all.end - all.start);
  for (let b = 0; b < buckets; b++) {
    const from = all.start + (duration * b) / buckets, to = all.start + (duration * (b + 1)) / buckets;
    const best = windows.filter(w => w.start >= from && w.start < to).sort((a, z) => z.score - a.score)[0];
    if (best) keep.add(best);
  }
  for (const w of [...windows].sort((a, z) => z.score - a.score)) { if (keep.size >= keepCount) break; keep.add(w); }
  const chosen = windows.filter(w => keep.has(w));
  const kept: { start: number; end: number }[] = [];
  const blocks: string[] = [];
  for (const w of chosen) {
    const context = opts.contextSeconds ?? 0;
    const phrases = context ? cleaned.filter(p => p.end > w.start - context && p.start < w.end + context) : w.phrases;
    const start = phrases[0]?.start ?? w.start, end = phrases.at(-1)?.end ?? w.end;
    const prev = kept.at(-1);
    if (prev && start - prev.end < 2) { const extra = phrases.filter(p => p.start >= prev.end); prev.end = Math.max(prev.end, end); blocks[blocks.length - 1] += "\n" + extra.map(line).join("\n"); }
    else { kept.push({ start, end }); blocks.push(phrases.map(line).join("\n")); }
  }
  const text = blocks.join("\n…\n");
  return { text, kept, originalChars, condensedChars: text.length, filtered: true };
}

/** Both boundaries must be inside the same shown block: never approve an unseen payoff across an excerpt gap. */
export function withinKept<T extends { start: number; end: number }>(segments: T[], kept: { start: number; end: number }[]) {
  return segments.filter(s => kept.some(k => s.start >= k.start && s.end <= k.end));
}
