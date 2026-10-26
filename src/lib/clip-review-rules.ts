import { z } from "zod";
export const viralReviewSchema = z.object({
  hook: z.number().int().min(0).max(100), pacing: z.number().int().min(0).max(100), retention: z.number().int().min(0).max(100),
  verdict: z.enum(["Viral", "Needs Work"]), critique: z.string().min(1).max(2000), feedback: z.array(z.string().min(1).max(500)).min(1).max(6),
  evidence: z.enum(["transcript", "structure-only"]),
});
export type ViralReview = z.infer<typeof viralReviewSchema>;
export function canApproveClip(clip: {video_path: string | null; viral_review: unknown}) { return Boolean(clip.video_path && viralReviewSchema.safeParse(clip.viral_review).success); }
export const edgeVoices = [
  {id:"hi-IN-SwaraNeural",label:"Hindi · Swara"}, {id:"hi-IN-MadhurNeural",label:"Hindi · Madhur"},
  {id:"en-IN-NeerjaNeural",label:"English (India) · Neerja"}, {id:"en-IN-PrabhatNeural",label:"English (India) · Prabhat"},
  {id:"en-US-JennyNeural",label:"English (US) · Jenny"}, {id:"en-US-GuyNeural",label:"English (US) · Guy"},
] as const;
export const voiceInputSchema = z.object({text:z.string().trim().min(1).max(4000),voice:z.enum(["hi-IN-SwaraNeural","hi-IN-MadhurNeural","en-IN-NeerjaNeural","en-IN-PrabhatNeural","en-US-JennyNeural","en-US-GuyNeural"])});