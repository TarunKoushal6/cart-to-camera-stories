import { z } from "zod";

export const videoMetricsSchema = z.object({
  width: z.number().int().positive(), height: z.number().int().positive(), duration: z.number().positive(),
  decoded: z.boolean(), has_audio: z.boolean(), black_seconds: z.number().nonnegative(),
  silent_seconds: z.number().nonnegative(), caption_events: z.number().int().nonnegative(),
  caption_overlaps: z.number().int().nonnegative(), music: z.string().nullable(),
  warnings: z.array(z.string().max(300)).max(12),
});
export const videoInspectionSchema = z.object({
  metrics: videoMetricsSchema,
  frames: z.array(z.object({ second: z.number().nonnegative(), jpeg: z.string().max(160000).regex(/^[A-Za-z0-9+/=]+$/) })).min(1).max(5),
});
export type VideoInspection = z.infer<typeof videoInspectionSchema>;
export const videoQualitySchema = z.object({
  status: z.enum(["Checked", "Needs Work", "Unverified"]),
  metrics: videoMetricsSchema.optional(), frames_checked: z.number().int().min(0).max(5),
  visual_notes: z.string().max(1600), limitations: z.string().max(1200),
});