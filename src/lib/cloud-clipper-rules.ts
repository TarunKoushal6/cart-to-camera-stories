import { z } from "zod";
import { cueSchema, segmentSchema } from "./studio-rules";

export function workerUrl(value: string) {
  const url = new URL(value.trim());
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
    host === "localhost" || !host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") ||
    /^[\d.]+$/.test(host) || host.includes(":")) {
    throw new Error("Use a public HTTPS worker URL without credentials or query parameters.");
  }
  return url.toString().replace(/\/+$/, "");
}
export const cloudTargetSchema = z.object({
  id: z.string().uuid(), path: z.string(), segment: segmentSchema, upload_url: z.string().url(),
});
export const workerStatusSchema = z.object({
  status: z.enum(["transcribing", "analyzed", "rendering", "complete", "failed"]),
  duration: z.number().min(20).max(86400).optional(),
  cues: z.array(cueSchema).max(15000).optional(),
  completed: z.array(z.string().uuid()).max(15).optional(),
  error: z.string().max(500).optional(),
});
export const workerHealthSchema = z.object({ ok: z.literal(true), protocol: z.literal("cutline-v1"), protected: z.boolean(), engine: z.enum(["cutline", "openshorts"]).optional() });
export function cloudStage(status: string) {
  return status === "ready" ? "Ready for your approval" : status === "failed" ? "Cloud clipping failed" :
    status === "finalizing" ? "Reviewing saved clips" : status === "rendering" ? "Cutting and saving vertical clips" :
    status === "analyzing" ? "Your AI is selecting moments" : "Downloading and transcribing";
}