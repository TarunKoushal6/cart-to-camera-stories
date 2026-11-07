import type { Cue } from "./studio-rules";

/** Merge only overlapping repetitions; keep genuine sequential repeated speech. */
export function captionTimeline(cues: Cue[]): Cue[] {
  const words: Cue[] = [];
  for (const cue of cues) {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.end <= cue.start) continue;
    const parts = cue.text.normalize("NFC").replace(/[{}\\]/g, "").trim().split(/\s+/).filter(Boolean);
    parts.forEach((text, i) => words.push({ text, start: cue.start + i * (cue.end - cue.start) / parts.length, end: cue.start + (i + 1) * (cue.end - cue.start) / parts.length }));
  }
  words.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Cue[] = [];
  for (const word of words) {
    let duplicate: Cue | undefined;
    for (let i = merged.length - 1; i >= 0; i--) {
      const previous = merged[i];
      if (!previous) continue;
      if (word.start - previous.start > 10) break;
      if (previous.text.toLocaleUpperCase() === word.text.toLocaleUpperCase() && previous.end > word.start && previous.start < word.end) { duplicate = previous; break; }
    }
    if (duplicate) duplicate.end = Math.max(duplicate.end, word.end);
    else merged.push({ ...word });
  }
  return merged.map((word, i) => ({ ...word, start: Math.max(0, word.start), end: Math.min(word.end, merged[i + 1]?.start ?? word.end) })).filter(word => word.end - word.start >= 0.01);
}