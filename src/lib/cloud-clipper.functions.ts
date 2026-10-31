import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { workerUrl, workerProgressSchema } from "./cloud-clipper-rules";
import { youtubeId } from "./studio-rules";

export const saveCloudWorker = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ url: z.string().max(500), token: z.string().max(3000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const url = workerUrl(data.url);
    const { checkWorker } = await import("./cloud-clipper.server");
    await checkWorker(url, data.token?.trim() || "");
    const secret = process.env["STUDIO_ENCRYPTION_KEY"];
    if (!secret) throw new Error("Secure credential storage is not configured.");
    const { encrypt } = await import("./studio-crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("studio_credentials").upsert({
      user_id: context.userId, kind: "cloud_worker", provider: "fastapi", base_url: url,
      encrypted_key: await encrypt(data.token?.trim() || "", secret), updated_at: new Date().toISOString(),
    });
    if (error) throw new Error("Couldn't save cloud worker.");
    return { saved: true };
  });

export const startCloudCut = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ url: z.string().max(2000), sourceId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const youtube = youtubeId(data.url);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: settings } = await supabaseAdmin.from("studio_credentials").select("*").eq("user_id", context.userId);
    if (!settings?.some(s => s.kind === "ai")) throw new Error("Save your AI endpoint, key and model in Settings first.");
    const secret = process.env["STUDIO_ENCRYPTION_KEY"];
    if (!secret) throw new Error("Secure credential storage is not configured.");
    let sourceId = data.sourceId;
    const { checkWorker, resolveWorker, callWorker } = await import("./cloud-clipper.server");
    const worker = await resolveWorker(settings.find(s => s.kind === "cloud_worker"), secret);
    await checkWorker(worker.url, worker.token);
    if (sourceId) {
      const { data: source } = await context.supabase.from("studio_sources").select("youtube_id").eq("id", sourceId).single();
      if (!source || source.youtube_id !== youtube) throw new Error("Source video not found.");
    } else {
      const { fetchYouTube } = await import("./youtube.server");
      // Metadata/caption blocking must not prevent the worker's independent downloader.
      const video = await fetchYouTube(youtube).catch(() => ({ title: `YouTube video ${youtube}`, author: "", thumbnail_url: null,
        duration: null, transcript: [], transcript_status: "unavailable" }));
      const { data: source, error } = await context.supabase.from("studio_sources").insert({ ...video,
        transcript: video.transcript.map(c => ({ ...c })), youtube_id: youtube,
        url: `https://www.youtube.com/watch?v=${youtube}`, user_id: context.userId,
      }).select("id").single();
      if (error || !source) throw new Error("Couldn't import source video.");
      sourceId = source.id;
    }
    const { data: existing } = await context.supabase.from("studio_cloud_jobs").select("id,status").eq("source_id", sourceId)
      .not("status", "in", "(ready,failed)").limit(1).maybeSingle();
    if (existing) return { id: existing.id, sourceId };
    const jobId = crypto.randomUUID();
    const { error } = await supabaseAdmin.from("studio_cloud_jobs").insert({ id: jobId, user_id: context.userId,
      source_id: sourceId, worker_url: worker.url, worker_job_id: jobId });
    if (error) throw new Error("Couldn't create clipping job.");
    try {
      await callWorker(worker.url, worker.token, "/jobs", {
        id: jobId, url: `https://www.youtube.com/watch?v=${youtube}`,
      });
    } catch (e) {
      await supabaseAdmin.from("studio_cloud_jobs").update({ status: "failed", error: "Worker could not start. Check Settings and retry." }).eq("id", jobId);
      throw e;
    }
    return { id: jobId, sourceId };
  });

export const pollCloudCut = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { advanceCloudCut } = await import("./cloud-clipper-jobs.server");
    return advanceCloudCut(data, context);
  });

/** Read-only download/transcription progress; never advances or claims the job. */
export const cloudCutProgress = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: job } = await context.supabase.from("studio_cloud_jobs").select("status,worker_url,worker_job_id")
      .eq("id", data.jobId).eq("user_id", context.userId).maybeSingle();
    if (!job || job.status !== "transcribing") return null;
    const secret = process.env["STUDIO_ENCRYPTION_KEY"];
    if (!secret) return null;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: settings } = await supabaseAdmin.from("studio_credentials").select("*").eq("user_id", context.userId).eq("kind", "cloud_worker");
      const { callWorker, resolveWorker } = await import("./cloud-clipper.server");
      const worker = await resolveWorker(settings?.[0], secret);
      if (worker.url !== job.worker_url) return null;
      const parsed = workerProgressSchema.safeParse(await callWorker(job.worker_url, worker.token, `/jobs/${job.worker_job_id}`));
      return parsed.success && parsed.data.stage ? parsed.data : null;
    } catch { return null; }
  });
