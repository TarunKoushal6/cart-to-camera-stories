import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { cloudTargetSchema, workerStatusSchema, musicModeSchema, clipMusic, MUSIC_VOLUME, wantsOutro } from "./cloud-clipper-rules";
import { videoInspectionSchema } from "./video-quality-rules";

const ACTIVE = ["transcribing", "analyzing", "rendering", "finalizing"];

/** Called only after session or schedule authorization; always bound to the job owner. */
export async function advanceCloudCut(data: {jobId:string}, context: {supabase:SupabaseClient<Database>;userId:string}) {
    const { data: job } = await context.supabase.from("studio_cloud_jobs").select("*").eq("id", data.jobId).eq("user_id", context.userId).single();
    if (!job) throw new Error("Clipping job not found.");
    if (job.status === "ready" || job.status === "failed") return { status: job.status };
    const secret = process.env["STUDIO_ENCRYPTION_KEY"];
    if (!secret) throw new Error("Secure credential storage is not configured.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const leaseToken = crypto.randomUUID();
    const claimLease = await supabaseAdmin.rpc("claim_cloud_job", { _job_id: job.id, _owner_id: context.userId, _token: leaseToken });
    if (claimLease.error) throw new Error("Couldn't claim cloud job.");
    if (!claimLease.data) return { status: job.status };
    try {
    const { data: settings } = await supabaseAdmin.from("studio_credentials").select("*").eq("user_id", context.userId);
    const ai = settings?.find(s => s.kind === "ai");
    const { callWorker, resolveWorker } = await import("./cloud-clipper.server");
    const worker = await resolveWorker(settings?.find(s => s.kind === "cloud_worker"), secret);
    if (worker.url !== job.worker_url) throw new Error("Restore the worker settings used for this job.");
    const { withAi } = await import("./studio-ai-default.server");
    const token = worker.token;
    const state = workerStatusSchema.parse(await callWorker(job.worker_url, token, `/jobs/${job.worker_job_id}`));
    let targets = z.array(cloudTargetSchema.omit({ upload_url: true })).parse(job.clips);
    const finished = new Set(state.completed ?? []);
    const workerError = state.error || "Worker failed. Check worker logs; YouTube may block downloads or the host may lack memory.";
    // A worker that stopped part-way still keeps the clips it finished: those are attached below.
    if (state.status === "failed" && !targets.some(t => finished.has(t.id))) {
      await supabaseAdmin.from("studio_cloud_jobs").update({ status: "failed", error: workerError }).eq("id", job.id).in("status", ACTIVE);
      return { status: "failed" };
    }
    if (state.status === "analyzed") {
      if (!state.cues?.length || !state.duration) throw new Error("Worker returned no timed transcript.");
      // Claim once; concurrent browser polls must not create duplicate clips.
      const claim = await supabaseAdmin.from("studio_cloud_jobs").update({ status: "analyzing" }).eq("id", job.id).in("status", ["transcribing", "analyzing", "rendering"]).select("id").maybeSingle();
      if (!claim.data) return { status: job.status };
      try {
        const transcriptSave = await context.supabase.from("studio_sources").update({ transcript: state.cues.map(c => ({ ...c })), transcript_status: "imported", duration: state.duration }).eq("id", job.source_id).eq("user_id", context.userId);
        if (transcriptSave.error) throw new Error("Couldn't save transcript.");
        const { data: source } = await context.supabase.from("studio_sources").select("title").eq("id", job.source_id).eq("user_id", context.userId).single();
        if (!targets.length) {
        const { analyzeWithKey } = await import("./studio-ai.server");
        const cues = state.cues;
        const segments = await withAi(ai, secret, c => analyzeWithKey(c.provider, c.model, c.key, cues, c.baseUrl,
          { title: source?.title || "YouTube video", duration: state.duration!, outline: "" }));
        targets = segments.map(segment => { const id = crypto.randomUUID(); return { id, segment, path: `${context.userId}/clips/${id}/${job.id}.mp4` }; });
        const persisted = await supabaseAdmin.from("studio_cloud_jobs").update({ clips: targets.map(t => ({ ...t })) }).eq("id", job.id);
        if (persisted.error) throw new Error("Couldn't persist render targets.");
        }
        const { error } = await context.supabase.from("studio_clips").upsert(targets.map(t => ({ id: t.id, source_id: job.source_id, user_id: context.userId,
          start_seconds: t.segment.start, end_seconds: t.segment.end, title: t.segment.title, score: t.segment.score, reason: t.segment.reason,
          caption: state.cues?.filter(c => c.end > t.segment.start && c.start < t.segment.end).map(c => c.text).join(" ").slice(0, 2200) || t.segment.title })), { onConflict: "id", ignoreDuplicates: true });
        if (error) throw new Error("Couldn't stage clips.");
        const uploads = [];
        for (const t of targets) {
          const upload = await supabaseAdmin.storage.from("videos").createSignedUploadUrl(t.path);
          if (upload.error || !upload.data) throw new Error("Couldn't authorize clip upload.");
          uploads.push({ ...t, upload_url: upload.data.signedUrl });
        }
        // Older workers ignore `music`; newer ones mix a ducked royalty-free bed per clip mood.
        const mode = musicModeSchema.catch("auto").parse(job.music);
        await callWorker(job.worker_url, token, `/jobs/${job.worker_job_id}/render`, { targets: uploads,
          music: { volume: MUSIC_VOLUME, clips: Object.fromEntries(uploads.map(u => [u.id, clipMusic(mode, u.segment.vibe)])) },
          outro: wantsOutro((await context.supabase.auth.getUser()).data.user?.email) });
        // Status guards: a Stop pressed mid-tick must never be overwritten back to an active state.
        await supabaseAdmin.from("studio_cloud_jobs").update({ status: "rendering", error: null }).eq("id", job.id).in("status", ACTIVE);
        return { status: "rendering" };
      } catch (e) {
        // App-authored messages never include provider bodies, so the real reason is safe to show.
        const reason = e instanceof Error ? e.message.slice(0, 400) : "Unknown error";
        await supabaseAdmin.from("studio_cloud_jobs").update({ status: "analyzing", error: `AI step failed, retrying: ${reason}` }).eq("id", job.id).in("status", ACTIVE);
        throw e;
      }
    }
    const workerDone = state.status === "complete" || state.status === "failed";
    if (targets.length && (workerDone || (state.status === "rendering" && targets.some(t => finished.has(t.id))))) {
      const claim = await supabaseAdmin.from("studio_cloud_jobs").update({ status: "finalizing" }).eq("id", job.id).in("status", ["rendering", "analyzing", "finalizing"]).select("id").maybeSingle();
      if (!claim.data) return { status: job.status };
      try {
        const { data: source } = await context.supabase.from("studio_sources").select("transcript").eq("id", job.source_id).eq("user_id", context.userId).single();
        const { cueSchema } = await import("./studio-rules");
        const cues = z.array(cueSchema).parse(source?.transcript || []);
        const { reviewRenderedWithKey } = await import("./studio-ai.server");
        const { viralReviewSchema } = await import("./clip-review-rules");
        const current = await context.supabase.from("studio_clips").select("id,video_path,viral_review").eq("source_id", job.source_id).eq("user_id", context.userId);
        if (current.error) throw new Error("Couldn't load staged clips.");
        const remaining = targets.filter(t => !current.data.some(c => c.id === t.id && c.video_path === t.path && viralReviewSchema.safeParse(c.viral_review).success));
        // Attach clips as soon as the worker finishes each one; one AI review per tick keeps requests bounded.
        const renderedNow = remaining.filter(t => finished.has(t.id));
        for (const t of renderedNow.slice(0, 1)) {
          const folder = t.path.slice(0, t.path.lastIndexOf("/"));
          const name = t.path.slice(t.path.lastIndexOf("/") + 1);
          const files = await supabaseAdmin.storage.from("videos").list(folder, { search: name });
          const file = files.data?.find(f => f.name === name);
          if (files.error || !file || file.metadata?.mimetype !== "video/mp4" || !file.metadata?.size || file.metadata.size > 50 * 1024 * 1024) throw new Error("Worker upload is missing or exceeds 50 MB.");
          // Attaching the video first invalidates any stale review through the existing DB trigger.
          const attached = await context.supabase.from("studio_clips").update({ video_path: t.path, approved_at: null }).eq("id", t.id).eq("user_id", context.userId).select("caption,voiceover,start_seconds,end_seconds").single();
          if (attached.error || !attached.data) throw new Error("Couldn't attach saved clip.");
          // Old workers are explicitly unverified, never presented as a successful video quality check.
          const inspection = await callWorker(job.worker_url, token, `/jobs/${job.worker_job_id}/clips/${t.id}/quality`)
            .then(raw => videoInspectionSchema.parse(raw)).catch(() => null);
          const review = viralReviewSchema.parse(await withAi(ai, secret, c => reviewRenderedWithKey(c.provider, c.model, c.key, c.baseUrl,
            t.segment.title, cues.filter(c => c.end > t.segment.start && c.start < t.segment.end), attached.data.caption, t.segment.end - t.segment.start, inspection)));
          let saveReview = context.supabase.from("studio_clips").update({ viral_review: review, approved_at: null }).eq("id", t.id).eq("user_id", context.userId).eq("caption", attached.data.caption).eq("video_path", t.path).eq("start_seconds", attached.data.start_seconds).eq("end_seconds", attached.data.end_seconds);
          saveReview = attached.data.voiceover === null ? saveReview.is("voiceover", null) : saveReview.eq("voiceover", attached.data.voiceover);
          const saved = await saveReview.select("id").maybeSingle();
          if (saved.error || !saved.data) throw new Error("Clip changed during AI review. Run a fresh review.");
        }
        const moreToReview = renderedNow.length > 1, saved = targets.length - remaining.length + Math.min(1, renderedNow.length);
        const nextStatus = moreToReview || !workerDone ? "rendering" : state.status === "failed" ? "failed" : "ready";
        const error = nextStatus === "failed" ? `${saved} of ${targets.length} clips saved before the worker stopped. ${workerError}`
          : nextStatus === "ready" && saved < targets.length ? `${saved} of ${targets.length} clips saved; the worker skipped the rest.` : null;
        await supabaseAdmin.from("studio_cloud_jobs").update({ status: nextStatus, error }).eq("id", job.id).in("status", ACTIVE);
        return { status: nextStatus };
      } catch (e) {
        const reason = e instanceof Error ? e.message.slice(0, 400) : "Unknown error";
        await supabaseAdmin.from("studio_cloud_jobs").update({ status: "finalizing", error: `Verification or AI review failed, retrying (saved clips stay in your library): ${reason}` }).eq("id", job.id).in("status", ACTIVE);
        throw e;
      }
    }
    return { status: job.status };
    } finally {
      await supabaseAdmin.from("studio_cloud_jobs").update({ processing_token: null, processing_until: null }).eq("id", job.id).eq("processing_token", leaseToken);
    }
}
