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
        return Response.json({ processed: n });
      },
    },
  },
});
