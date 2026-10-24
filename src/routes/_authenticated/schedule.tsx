import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { RefreshCw, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { refreshPost } from "@/lib/ugc.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/schedule")({
  head: () => ({
    meta: [
      { title: "Posts — POVreel" },
      { name: "description", content: "Scheduled and published Instagram reels." },
      { property: "og:title", content: "Posts — POVreel" },
      { property: "og:description", content: "Scheduled and published Instagram reels." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Schedule,
});

function Schedule() {
  const qc = useQueryClient();
  const refresh = useServerFn(refreshPost);
  const { data: posts = [] } = useQuery({
    queryKey: ["posts"],
    queryFn: async () =>
      (await supabase.from("posts").select("*, reviews(id, hook, products(title))").order("scheduled_at", { ascending: false })).data ?? [],
    refetchInterval: 30000,
  });

  return (
    <div>
      <h1 className="font-display text-4xl font-bold">Posts</h1>
      <p className="text-muted-foreground mt-1">Scheduled reels go out automatically within about 5 minutes of their time.</p>
      <div className="mt-6 divide-y divide-border rounded-xl border border-border bg-card">
        {posts.length === 0 && <p className="p-5 text-muted-foreground">Nothing scheduled yet.</p>}
        {posts.map((p) => (
          <div key={p.id} className="p-4 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <Link to="/reviews/$id" params={{ id: p.review_id }} className="font-medium hover:text-primary line-clamp-1">
                {p.reviews?.products?.title}
              </Link>
              <div className="text-sm text-muted-foreground">{format(new Date(p.scheduled_at), "d MMM yyyy, h:mm a")}</div>
              {p.error && <div className="text-sm text-destructive">{p.error}</div>}
            </div>
            <Badge variant={p.status === "published" ? "default" : p.status === "failed" ? "destructive" : "secondary"}>{p.status}</Badge>
            {p.status === "processing" && (
              <Button size="sm" variant="ghost" onClick={async () => { await refresh({ data: { postId: p.id } }); qc.invalidateQueries({ queryKey: ["posts"] }); }}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
            {p.status === "scheduled" && (
              <Button size="sm" variant="ghost" aria-label="Cancel" onClick={async () => { await supabase.from("posts").delete().eq("id", p.id); qc.invalidateQueries({ queryKey: ["posts"] }); }}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
