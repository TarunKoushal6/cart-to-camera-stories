import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { RefreshCw, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { refreshYouTubePosts } from "@/lib/youtube-publishing.functions";
import { refreshStudioPosts } from "@/lib/studio.functions";
import { refreshPost } from "@/lib/ugc.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/schedule")({
  head: () => ({
    meta: [
      { title: "Posts — Cutline" },
      { name: "description", content: "Scheduled and published Instagram, Facebook and YouTube clips." },
      { property: "og:title", content: "Posts — Cutline" },
      { property: "og:description", content: "Scheduled and published Instagram, Facebook and YouTube clips." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Schedule,
});

function Schedule() {
  const qc = useQueryClient();
  const refresh = useServerFn(refreshPost);
  const refreshClips = useServerFn(refreshStudioPosts),refreshYouTube=useServerFn(refreshYouTubePosts);
  const {data:youtubePosts=[]}=useQuery({queryKey:["youtube-posts"],queryFn:async()=>{const r=await supabase.from("youtube_posts").select("*,studio_clips(title)").order("created_at",{ascending:false});if(r.error)throw r.error;return r.data;},refetchInterval:30000});
  const {data:clipPosts=[]}=useQuery({queryKey:["studio-posts"],queryFn:async()=>{const r=await supabase.from("studio_posts").select("*,studio_clips(title)").order("scheduled_at",{ascending:false});if(r.error)throw r.error;return r.data;},refetchInterval:30000});
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
      <div className="mt-6"><Button variant="outline" onClick={async()=>{await Promise.all([refreshClips(),refreshYouTube()]);qc.invalidateQueries({queryKey:["studio-posts"]});qc.invalidateQueries({queryKey:["youtube-posts"]});}}> <RefreshCw className="h-4 w-4"/>Refresh clip posts</Button></div>
      <div className="mt-5 divide-y divide-border">{!clipPosts.length&&<p className="py-8 text-muted-foreground">No clip posts yet.</p>}{clipPosts.map(p=><div key={p.id} className="py-4 flex flex-wrap gap-3 items-center"><div className="flex-1 min-w-0"><Link to="/clips/$id" params={{id:p.clip_id}} className="font-medium">{p.studio_clips?.title}</Link><p className="text-xs text-muted-foreground capitalize mt-1">{p.platform} · {format(new Date(p.scheduled_at),"d MMM yyyy, h:mm a")}</p>{p.error&&<p className="text-xs text-destructive mt-2">{p.error}</p>}</div><Badge variant={p.status==="failed"?"destructive":"secondary"}>{p.status}</Badge>{p.status==="scheduled"&&<Button variant="ghost" size="icon" aria-label="Cancel clip post" onClick={async()=>{await supabase.from("studio_posts").delete().eq("id",p.id);qc.invalidateQueries({queryKey:["studio-posts"]});}}><Trash2 className="h-4 w-4"/></Button>}</div>)}</div>
      {!!youtubePosts.length&&<section className="mt-8"><h2 className="font-display text-xl">YouTube Shorts</h2><div className="divide-y divide-border mt-3">{youtubePosts.map(p=><div key={p.id} className="py-4 flex flex-wrap gap-3 items-center"><div className="flex-1 min-w-0"><Link to="/clips/$id" params={{id:p.clip_id}} className="font-medium">{p.title}</Link><p className="text-xs text-muted-foreground mt-1 capitalize">{p.privacy} · {p.scheduled_at?format(new Date(p.scheduled_at),"d MMM yyyy, h:mm a"):"Immediate upload"}</p>{p.media_id&&<a className="text-xs text-primary underline" href={`https://www.youtube.com/watch?v=${encodeURIComponent(p.media_id)}`} target="_blank" rel="noreferrer">View on YouTube</a>}{p.error&&<p className="text-destructive text-xs mt-2">{p.error}</p>}</div><Badge variant={p.status==="failed"?"destructive":"secondary"}>{p.status==="published"&&p.privacy!=="public"?"uploaded":p.status}</Badge></div>)}</div></section>}
      {!!posts.length&&<h2 className="text-xl font-display mt-10">Legacy product posts</h2>}
      <div className="mt-6 divide-y divide-border rounded-xl border border-border bg-card">
        
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
