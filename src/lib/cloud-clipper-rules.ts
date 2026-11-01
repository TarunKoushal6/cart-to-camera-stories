import { z } from "zod";
import { cueSchema, segmentSchema, VIBES } from "./studio-rules";

/** Background music for cloud clips: "auto" follows the AI's per-clip mood, "off" keeps original audio only. */
export const MUSIC_MODES = ["auto", "off", ...VIBES] as const;
export type MusicMode = typeof MUSIC_MODES[number];
export const musicModeSchema = z.enum(MUSIC_MODES);
/** Music bed level under speech; the worker also ducks it further whenever someone talks. */
export const MUSIC_VOLUME = 0.16;
/** Mood the worker should use for one clip, or null for no music. */
export function clipMusic(mode: MusicMode, vibe?: string | null) {
  if (mode === "off") return null;
  if (mode !== "auto") return mode;
  return (VIBES as readonly string[]).includes(vibe ?? "") ? vibe as typeof VIBES[number] : "inspiring";
}

/** Shared worker used by every account that hasn't saved its own. */
export const DEFAULT_CLOUD_WORKER_URL = "https://periodically-reproduced-owned-controller.trycloudflare.com";

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
  stage: z.enum(["queued", "fetching_subtitles", "downloading", "preparing_audio", "loading_model", "transcribing", "analyzed"]).optional().catch(undefined),
  progress: z.object({ downloaded: maybeNum, total: maybeNum, speed: maybeNum, eta: maybeNum, part: maybeNum, percent: maybeNum, subtitles: z.boolean().optional() }).partial().optional().catch(undefined),
});
export type WorkerProgress = z.infer<typeof workerProgressSchema>;
export const workerStatusSchema = z.object({
  status: z.enum(["transcribing", "analyzed", "rendering", "complete", "failed"]),
  duration: z.number().min(20).max(86400).optional(),
  cues: z.array(cueSchema).max(75000).optional(),
  completed: z.array(z.string().uuid()).max(15).optional(),
  error: z.string().max(20000).optional(),
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
export function formatEta(s: number) {
  if (s < 60) return `${Math.round(s)}s left`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min left` : `${Math.floor(m / 60)}h ${m % 60}m left`;
}
/** Download speed in both MB/s and Mbps, e.g. "15.4 MB/s (129 Mbps)". */
export function formatSpeed(bytesPerSecond: number) {
  const mbps = (bytesPerSecond * 8) / 1e6;
  return `${formatBytes(bytesPerSecond)}/s (${mbps >= 10 ? Math.round(mbps) : mbps.toFixed(1)} Mbps)`;
}
/** Separate size / speed / ETA strings for the download stage. */
export function downloadStats(p: LiveCloudProgress): { size: string; speed: string | null; eta: string | null; percent: number | null } | null {
  if (p?.stage !== "downloading" || !p.progress?.downloaded) return null;
  const g = p.progress, downloaded = g.downloaded ?? 0;
  const percent = g.total ? Math.min(100, (downloaded / g.total) * 100) : null;
  return {
    size: g.total ? `${formatBytes(downloaded)} / ${formatBytes(g.total)} (${Math.round(percent!)}%)` : `${formatBytes(downloaded)} downloaded`,
    speed: g.speed ? formatSpeed(g.speed) : null,
    eta: g.eta ? formatEta(g.eta) : null,
    percent,
  };
}
/** Human label + optional percent for the worker's download/transcription step. */
export function progressSummary(p: WorkerProgress | null | undefined): { label: string; percent: number | null } | null {
  if (!p?.stage) return null;
  const g = p.progress ?? {};
  if (p.stage === "queued") return { label: "Waiting for the worker to start", percent: null };
  if (p.stage === "fetching_subtitles") return { label: "Checking YouTube captions", percent: null };
  if (p.stage === "downloading") {
    const d = downloadStats(p);
    if (!d) return { label: "Starting video download", percent: null };
    const parts = [d.size, d.speed, d.eta, g.part && g.part > 1 ? "audio track" : null].filter(Boolean);
    return { label: `Downloading video · ${parts.join(" · ")}`, percent: d.percent };
  }
  if (p.stage === "preparing_audio" && g.subtitles) return { label: "Using YouTube captions · no transcription needed", percent: 100 };
  if (p.stage === "preparing_audio") return { label: `Downloaded ${g.total ? formatBytes(g.total) : ""} · extracting audio`.replace("  ", " "), percent: 100 };
  if (p.stage === "loading_model") return { label: "Loading speech model (first run downloads it)", percent: null };
  if (p.stage === "transcribing") return { label: `Transcribing speech${g.percent != null ? ` · ${Math.round(g.percent)}%` : ""}`, percent: g.percent ?? null };
  return null;
}
export const CLOUD_STEPS = ["Download video", "Captions", "AI hook selection", "9:16 vertical cut & burn captions", "Ready"] as const;
export type LiveCloudProgress = (WorkerProgress & { rendered?: number; total?: number }) | null | undefined;
/** Current step (index into CLOUD_STEPS), detail line and percent for a cloud job. */
export function cloudJobProgress(status: string, live: LiveCloudProgress): { step: number; label: string; detail: string | null; percent: number | null } {
  if (status === "ready") return { step: CLOUD_STEPS.length, label: "Ready for your approval", detail: null, percent: 100 };
  if (status === "failed") return { step: -1, label: "Cloud clipping failed", detail: null, percent: null };
  if (status === "analyzing") return { step: 2, label: CLOUD_STEPS[2], detail: "Your AI is reading the transcript for viral moments", percent: null };
  if (status === "finalizing") return { step: 3, label: "Reviewing saved clips", detail: "Rating each clip before it's ready", percent: null };
  if (status === "rendering") {
    const total = live?.total ?? 0, done = Math.min(live?.rendered ?? 0, total);
    return { step: 3, label: CLOUD_STEPS[3], detail: total ? `${done} of ${total} clips saved` : null, percent: total ? (done / total) * 100 : null };
  }
  const stage = live?.stage, summary = progressSummary(live);
  if (!stage || stage === "queued") return { step: 0, label: CLOUD_STEPS[0], detail: summary?.label ?? "Waiting for the worker to start", percent: null };
  if (stage === "downloading") return { step: 0, label: CLOUD_STEPS[0], detail: summary?.label ?? null, percent: summary?.percent ?? null };
  if (stage === "analyzed") return { step: 2, label: CLOUD_STEPS[2], detail: null, percent: null };
  return { step: 1, label: CLOUD_STEPS[1], detail: summary?.label ?? null, percent: stage === "transcribing" ? summary?.percent ?? null : null };
}
/** Plain-language reason for a failed worker HTTP response. */
export function workerHttpError(status: number) {
  if (status === 530) return "Cloud worker is offline (HTTP 530): the Cloudflare tunnel or the worker server (Uvicorn) behind it is stopped or disconnected. Restart the worker and its tunnel, then retry.";
  return `Cloud worker request failed (${status}). Check its URL, token and availability.`;
}
