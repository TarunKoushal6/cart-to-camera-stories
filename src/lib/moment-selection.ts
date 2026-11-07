import { condenseTranscript, withinKept, toPhrases } from "./transcript-condense";
import { formatStamp, transcriptEnd, type Cue, type segmentSchema } from "./studio-rules";
import type { z } from "zod";

export type Moment = z.infer<typeof segmentSchema>;
export const MAX_JOB_CLIPS = 60;

/** Uniform map includes quiet topics too; excerpts are discovery hints, never timing evidence. */
export function topicMap(cues: Cue[], start: number, end: number) {
  const phrases = toPhrases(cues.filter(c => c.end > start && c.start < end));
  const rows: string[] = [];
  for (let t = start; t < end; t += 30) {
    const local = phrases.filter(p => p.end > t && p.start < t + 30);
    if (!local.length) continue;
    const text = local.map(p => p.text).join(" ");
    rows.push(`[${formatStamp(t)}–${formatStamp(Math.min(t + 30, end))}] ${text.length > 280 ? text.slice(0, 170) + " … " + text.slice(-100) : text}`);
  }
  return rows.join("\n");
}

export function topicContexts(cues: Cue[], topics: { start: number; end: number }[], start: number, end: number) {
  const ranges: { start: number; end: number }[] = [];
  for (const t of topics.slice(0, 24).sort((a, b) => a.start - b.start)) {
    if (!Number.isFinite(t.start) || !Number.isFinite(t.end) || t.end <= t.start || t.start < start || t.start >= end) continue;
    const a = Math.max(0, t.start - 20), b = Math.min(transcriptEnd(cues), t.start + Math.min(120, t.end - t.start) + 20);
    const prev = ranges.at(-1);
    if (prev && a <= prev.end && b - prev.start <= 240) prev.end = Math.max(prev.end, b);
    else ranges.push({ start: a, end: b });
  }
  return ranges.map(range => {
    const phrases = toPhrases(cues.filter(c => c.start >= range.start && c.end <= range.end));
    const text = phrases.map(p => `[${p.start.toFixed(2)}–${p.end.toFixed(2)}s] ${p.text}`).join("\n");
    return { text, kept: [{ start: phrases[0]?.start ?? range.start, end: phrases.at(-1)?.end ?? range.end }], start, end,
      filtered: false, originalChars: text.length, condensedChars: text.length };
  }).filter(b => b.text);
}

/** At most eight chronological, independently condensed reads; the full raw transcript is never sent. */
export function momentBatches(cues: Cue[]) {
  const duration = transcriptEnd(cues);
  const span = Math.max(900, Math.ceil(duration / 8));
  const batches = [];
  for (let start = 0; start < duration; start += span) {
    const end = Math.min(duration, start + span);
    const window = cues.filter(c => c.end > start && c.start < end + 15);
    if (!window.length) continue;
    const condensed = condenseTranscript(window, { buckets: 2, minWords: 500, windowSeconds: 90, contextSeconds: 20 });
    const blocks = condensed.text.split("\n…\n");
    const text = blocks.map((block, i) => `${block}\n[${formatStamp(condensed.kept[i]?.end ?? end)}] END OF SHOWN BLOCK`).join("\n…\n");
    batches.push({ ...condensed, text, condensedChars: text.length, start, end });
  }
  return batches;
}

/** Keep only evidenced windows; overlapping versions of the same moment compete by score, not length. */
export function mergeMoments(moments: Moment[]) {
  const selected: Moment[] = [];
  for (const moment of [...moments].sort((a, b) => b.score - a.score)) {
    const duplicate = selected.some(s => {
      const overlap = Math.max(0, Math.min(s.end, moment.end) - Math.max(s.start, moment.start));
      return overlap / Math.min(s.end - s.start, moment.end - moment.start) > 0.5;
    });
    if (!duplicate) selected.push(moment);
  }
  // Round-robin chronological quarters prevents an early hot section monopolizing a large batch.
  if (selected.length > MAX_JOB_CLIPS) {
    const last = Math.max(...selected.map(s => s.end));
    const groups = Array.from({ length: 8 }, (_, i) => selected.filter(s => Math.min(7, Math.floor(s.start / last * 8)) === i));
    const fair: Moment[] = [];
    while (fair.length < MAX_JOB_CLIPS && groups.some(g => g.length)) {
      for (const group of groups) { const next = group.shift(); if (next && fair.length < MAX_JOB_CLIPS) fair.push(next); }
    }
    return fair.sort((a, b) => a.start - b.start);
  }
  return selected.sort((a, b) => a.start - b.start);
}

export function evidencedMoments(moments: Moment[], batch: ReturnType<typeof momentBatches>[number]) {
  return withinKept(moments, batch.kept).filter(s => s.start >= batch.start && s.start < batch.end);
}