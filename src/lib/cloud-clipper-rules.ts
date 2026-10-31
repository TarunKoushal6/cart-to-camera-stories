import { z } from "zod";
import { cueSchema, segmentSchema } from "./studio-rules";

/** Shared worker used by every account that hasn't saved its own. */
export const DEFAULT_CLOUD_WORKER_URL = "https://interstate-boolean-pediatric-associated.trycloudflare.com";

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
const maybeNum = z.number().nonnegative().nullable().optional();
export const workerProgressSchema = z.object({
  stage: z.enum(["queued", "downloading", "preparing_audio", "loading_model", "transcribing", "analyzed"]).optional().catch(undefined),
  progress: z.object({ downloaded: maybeNum, total: maybeNum, speed: maybeNum, eta: maybeNum, part: maybeNum, percent: maybeNum }).partial().optional().catch(undefined),
});
export type WorkerProgress = z.infer<typeof workerProgressSchema>;
export const workerStatusSchema = z.object({
  status: z.enum(["transcribing", "analyzed", "rendering", "complete", "failed"]),
  duration: z.number().min(20).max(86400).optional(),
  cues: z.array(cueSchema).max(15000).optional(),
  completed: z.array(z.string().uuid()).max(15).optional(),
  error: z.string().max(500).optional(),
}).merge(workerProgressSchema);
export const workerHealthSchema = z.object({ ok: z.literal(true), protocol: z.literal("cutline-v1"), protected: z.boolean(), engine: z.enum(["cutline", "openshorts"]).optional() });
export function cloudStage(status: string) {
  return status === "ready" ? "Ready for your approval" : status === "failed" ? "Cloud clipping failed" :
    status === "finalizing" ? "Reviewing saved clips" : status === "rendering" ? "Cutting and saving vertical clips" :
    status === "analyzing" ? "Your AI is selecting moments" : "Downloading and transcribing";
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
function formatEta(s: number) {
  if (s < 60) return `${Math.round(s)}s left`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min left` : `${Math.floor(m / 60)}h ${m % 60}m left`;
}
/** Human label + optional percent for the worker's download/transcription step. */
export function progressSummary(p: WorkerProgress | null | undefined): { label: string; percent: number | null } | null {
  if (!p?.stage) return null;
  const g = p.progress ?? {};
  if (p.stage === "queued") return { label: "Waiting for the worker to start", percent: null };
  if (p.stage === "downloading") {
    if (!g.downloaded) return { label: "Starting video download", percent: null };
    const parts = [g.total ? `${formatBytes(g.downloaded)} of ${formatBytes(g.total)}` : `${formatBytes(g.downloaded)} downloaded`];
    if (g.speed) parts.push(`${formatBytes(g.speed)}/s`);
    if (g.eta) parts.push(formatEta(g.eta));
    if (g.part && g.part > 1) parts.push("audio track");
    return { label: `Downloading video · ${parts.join(" · ")}`, percent: g.total ? Math.min(100, (g.downloaded / g.total) * 100) : null };
  }
  if (p.stage === "preparing_audio") return { label: `Downloaded ${g.total ? formatBytes(g.total) : ""} · extracting audio`.replace("  ", " "), percent: 100 };
  if (p.stage === "loading_model") return { label: "Loading speech model (first run downloads it)", percent: null };
  if (p.stage === "transcribing") return { label: `Transcribing speech${g.percent != null ? ` · ${Math.round(g.percent)}%` : ""}`, percent: g.percent ?? null };
  return null;
}