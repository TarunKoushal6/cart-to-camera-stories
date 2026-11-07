import { condenseTranscript, withinKept } from "./transcript-condense";
import { formatStamp, transcriptEnd, type Cue, type segmentSchema } from "./studio-rules";
import type { z } from "zod";

export type Moment = z.infer<typeof segmentSchema>;
export const MAX_JOB_CLIPS = 60;

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