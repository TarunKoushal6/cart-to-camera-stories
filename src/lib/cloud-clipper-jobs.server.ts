import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { cloudTargetSchema, workerStatusSchema } from "./cloud-clipper-rules";
import { providers } from "./studio-rules";

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
    const worker = settings?.find(s => s.kind === "cloud_worker");
    const ai = settings?.find(s => s.kind === "ai");
    if (!worker || worker.base_url !== job.worker_url || !ai) throw new Error("Restore the worker and AI settings used for this job.");
    const { decrypt } = await import("./studio-crypto.server");
    const { callWorker } = await import("./cloud-clipper.server");
    const token = await decrypt(worker.encrypted_key, secret);
    const state = workerStatusSchema.parse(await callWorker(job.worker_url, token, `/jobs/${job.worker_job_id}`));
    if (state.status === "failed") {
      await supabaseAdmin.from("studio_cloud_jobs").update({ status: "failed", error: state.error || "Worker failed. Check worker logs; YouTube may block downloads or the host may lack memory." }).eq("id", job.id);
      return { status: "failed" };
    }
    let targets = z.array(cloudTargetSchema.omit({ upload_url: true })).parse(job.clips);
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
        const segments = await analyzeWithKey(z.enum(providers).parse(ai.provider), ai.model, await decrypt(ai.encrypted_key, secret), state.cues, ai.base_url,
          { title: source?.title || "YouTube video", duration: state.duration, outline: "" });
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
        await callWorker(job.worker_url, token, `/jobs/${job.worker_job_id}/render`, { targets: uploads });
        await supabaseAdmin.from("studio_cloud_jobs").update({ status: "rendering", error: null }).eq("id", job.id);
        return { status: "rendering" };
      } catch (e) {
        await supabaseAdmin.from("studio_cloud_jobs").update({ status: "analyzing", error: "Analysis or render handoff interrupted; retrying. Check AI settings and worker availability if this persists." }).eq("id", job.id);
        throw e;
      }
    }
    if (state.status === "complete" && targets.length) {
      const claim = await supabaseAdmin.from("studio_cloud_jobs").update({ status: "finalizing" }).eq("id", job.id).in("status", ["rendering", "analyzing", "finalizing"]).select("id").maybeSingle();
      if (!claim.data) return { status: job.status };
      try {
        const { data: source } = await context.supabase.from("studio_sources").select("transcript").eq("id", job.source_id).eq("user_id", context.userId).single();
        const { cueSchema } = await import("./studio-rules");
        const cues = z.array(cueSchema).parse(source?.transcript || []);
        const { reviewWithKey } = await import("./studio-ai.server");
        const { viralReviewSchema } = await import("./clip-review-rules");
        const key = await decrypt(ai.encrypted_key, secret);
        const current = await context.supabase.from("studio_clips").select("id,video_path,viral_review").eq("source_id", job.source_id).eq("user_id", context.userId);
        if (current.error) throw new Error("Couldn't load staged clips.");
        const remaining = targets.filter(t => !current.data.some(c => c.id === t.id && c.video_path === t.path && viralReviewSchema.safeParse(c.viral_review).success));
        // One AI review per tick keeps cloud requests bounded even for a 15-clip batch.
        for (const t of remaining.slice(0, 1)) {
          if (!state.completed?.includes(t.id)) throw new Error("Worker did not finish every clip.");
          const folder = t.path.slice(0, t.path.lastIndexOf("/"));
          const name = t.path.slice(t.path.lastIndexOf("/") + 1);
          const files = await supabaseAdmin.storage.from("videos").list(folder, { search: name });
          const file = files.data?.find(f => f.name === name);
          if (files.error || !file || file.metadata?.mimetype !== "video/mp4" || !file.metadata?.size || file.metadata.size > 50 * 1024 * 1024) throw new Error("Worker upload is missing or exceeds 50 MB.");
          // Attaching the video first invalidates any stale review through the existing DB trigger.
          const attached = await context.supabase.from("studio_clips").update({ video_path: t.path, approved_at: null }).eq("id", t.id).eq("user_id", context.userId).select("caption,voiceover,start_seconds,end_seconds").single();
          if (attached.error || !attached.data) throw new Error("Couldn't attach saved clip.");
          const review = viralReviewSchema.parse(await reviewWithKey(z.enum(providers).parse(ai.provider), ai.model, key, ai.base_url,
            t.segment.title, cues.filter(c => c.end > t.segment.start && c.start < t.segment.end), attached.data.caption, "", t.segment.end - t.segment.start));
          let saveReview = context.supabase.from("studio_clips").update({ viral_review: review, approved_at: null }).eq("id", t.id).eq("user_id", context.userId).eq("caption", attached.data.caption).eq("video_path", t.path).eq("start_seconds", attached.data.start_seconds).eq("end_seconds", attached.data.end_seconds);
          saveReview = attached.data.voiceover === null ? saveReview.is("voiceover", null) : saveReview.eq("voiceover", attached.data.voiceover);
          const saved = await saveReview.select("id").maybeSingle();
          if (saved.error || !saved.data) throw new Error("Clip changed during AI review. Run a fresh review.");
        }
        const nextStatus = remaining.length <= 1 ? "ready" : "rendering";
        await supabaseAdmin.from("studio_cloud_jobs").update({ status: nextStatus, error: null }).eq("id", job.id);
        return { status: nextStatus };
      } catch (e) {
        await supabaseAdmin.from("studio_cloud_jobs").update({ status: "finalizing", error: "Verification or AI review interrupted; retrying. Saved clips remain in your library." }).eq("id", job.id);
        throw e;
      }
    }
    return { status: job.status };
    } finally {
      await supabaseAdmin.from("studio_cloud_jobs").update({ processing_token: null, processing_until: null }).eq("id", job.id).eq("processing_token", leaseToken);
    }
}
