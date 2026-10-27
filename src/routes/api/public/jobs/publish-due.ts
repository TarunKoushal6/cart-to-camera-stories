import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/jobs/publish-due")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { advancePost } = await import("@/lib/instagram.server");
        const { data: due } = await supabaseAdmin
          .from("posts")
          .select("*")
          .or(`and(status.eq.scheduled,scheduled_at.lte.${new Date().toISOString()}),status.eq.processing`)
          .limit(20);
        let n = 0;
        for (const p of due ?? []) {
          await advancePost(supabaseAdmin, p);
          n++;
        }
        const { advanceStudioPost } = await import("@/lib/studio-meta.server");
        const { data: clipsDue } = await supabaseAdmin.from("studio_posts").select("*").or(`and(status.eq.scheduled,scheduled_at.lte.${new Date().toISOString()}),status.eq.processing`).limit(20);
        for (const post of clipsDue ?? []) {
          await advanceStudioPost(supabaseAdmin, post, process.env["STUDIO_ENCRYPTION_KEY"] || "");
          n++;
        }
        const {pollYouTubePost}=await import("@/lib/youtube-publishing.server");
        const {data:youtubeDue}=await supabaseAdmin.from("youtube_posts").select("*").in("status",["processing","scheduled"]).limit(20);
        for(const post of youtubeDue||[]){await pollYouTubePost(supabaseAdmin,post);n++;}
        const { advanceCloudCut } = await import("@/lib/cloud-clipper-jobs.server");
        const { data: cloudJobs } = await supabaseAdmin.from("studio_cloud_jobs").select("id,user_id")
          .in("status", ["transcribing", "analyzing", "rendering", "finalizing"]).order("created_at").limit(2);
        for (const job of cloudJobs || []) {
          try { await advanceCloudCut({ jobId: job.id }, { supabase: supabaseAdmin, userId: job.user_id }); n++; }
          catch { /* Transient worker/network errors retry on the next protected schedule tick. */ }
        }
        return Response.json({ processed: n });
      },
    },
  },
});
