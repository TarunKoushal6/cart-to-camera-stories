import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Film, Send, CalendarClock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { startVideo, pollVideo, schedulePost } from "@/lib/ugc.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/reviews/$id")({
  head: () => ({
    meta: [
      { title: "POV review — POVreel" },
      { name: "description", content: "Script, video and posting for a POV product review." },
      { property: "og:title", content: "POV review — POVreel" },
      { property: "og:description", content: "Script, video and posting for a POV product review." },
    ],
  }),
  component: Review,
});

function Review() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const start = useServerFn(startVideo);
  const poll = useServerFn(pollVideo);
  const post = useServerFn(schedulePost);
  const [busy, setBusy] = useState(false);
  const [caption, setCaption] = useState<string | null>(null);
  const [when, setWhen] = useState("");

  const { data: r } = useQuery({
    queryKey: ["review", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("reviews").select("*, products(title, url, source)").eq("id", id).single();
      if (error) throw error;
      let videoUrl: string | null = null;
      if (data.video_path) {
        const s = await supabase.storage.from("videos").createSignedUrl(data.video_path, 3600);
        videoUrl = s.data?.signedUrl ?? null;
      }
      return { ...data, videoUrl };
    },
  });
  const { data: ig } = useQuery({
    queryKey: ["ig"],
    queryFn: async () => (await supabase.from("instagram_accounts").select("username").maybeSingle()).data,
  });

  useEffect(() => {
    if (r?.status !== "rendering") return;
    const t = setInterval(async () => {
      try {
        const s = await poll({ data: { reviewId: id } });
        if (s.status !== "rendering") qc.invalidateQueries({ queryKey: ["review", id] });
        else if (s.stage !== r.stage) qc.invalidateQueries({ queryKey: ["review", id] });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Video check failed");
      }
    }, 8000);
    return () => clearInterval(t);
  }, [r?.status, r?.stage, id, poll, qc]);

  if (!r) return <Loader2 className="h-6 w-6 animate-spin" />;
  const [vo1, vo2 = ""] = r.voiceover.split("\n---\n");
  const cap = caption ?? `${r.caption}\n\n${r.hashtags}`;

  async function onVideo() {
    setBusy(true);
    try {
      await start({ data: { reviewId: id } });
      qc.invalidateQueries({ queryKey: ["review", id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the video");
    } finally {
      setBusy(false);
    }
  }

  async function onPost(scheduled: boolean) {
    if (scheduled && !when) return toast.error("Pick a date and time");
    setBusy(true);
    try {
      await post({ data: { reviewId: id, caption: cap, scheduledAt: scheduled ? new Date(when).toISOString() : null } });
      toast.success(scheduled ? "Scheduled" : "Sent to Instagram — it'll appear once processed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't post");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">← Products</Link>
      <h1 className="font-display text-3xl font-bold mt-2 line-clamp-2">{r.products?.title}</h1>
      <p className="mt-2 text-xl text-primary font-display">“{r.hook}”</p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {[{ n: "0–10s", vo: vo1, sc: r.scene_1 }, { n: "10–20s", vo: vo2, sc: r.scene_2 }].map((s) => (
            <section key={s.n} className="rounded-xl border border-border bg-card p-5">
              <div className="font-display text-sm text-primary">{s.n}</div>
              <h3 className="mt-2 text-xs uppercase tracking-wider text-muted-foreground">Voiceover</h3>
              <p className="mt-1">{s.vo}</p>
              <h3 className="mt-4 text-xs uppercase tracking-wider text-muted-foreground">POV shot</h3>
              <p className="mt-1 text-sm text-muted-foreground">{s.sc}</p>
            </section>
          ))}

          <section className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-display font-bold">Post to Instagram</h3>
            {!ig ? (
              <p className="mt-2 text-sm text-muted-foreground">
                <Link to="/instagram" className="text-primary underline">Connect your Instagram</Link> to post.
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Posting as @{ig.username}</p>
            )}
            <Textarea className="mt-3" rows={6} value={cap} onChange={(e) => setCaption(e.target.value)} />
            <div className="mt-3 flex flex-wrap gap-2 items-center">
              <Button disabled={busy || r.status !== "ready" || !ig} onClick={() => onPost(false)}>
                <Send className="h-4 w-4" /> Post now
              </Button>
              <Input type="datetime-local" className="w-auto" value={when} onChange={(e) => setWhen(e.target.value)} />
              <Button variant="secondary" disabled={busy || r.status !== "ready" || !ig} onClick={() => onPost(true)}>
                <CalendarClock className="h-4 w-4" /> Schedule
              </Button>
            </div>
            {r.status !== "ready" && <p className="mt-2 text-xs text-muted-foreground">Generate the video first.</p>}
          </section>
        </div>

        <aside>
          <div className="aspect-[9/16] rounded-xl border border-border bg-secondary overflow-hidden flex items-center justify-center">
            {r.videoUrl ? (
              <video src={r.videoUrl} controls playsInline className="h-full w-full object-cover" />
            ) : r.status === "rendering" ? (
              <div className="text-center p-6 text-sm text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mx-auto mb-3 text-primary" />
                {r.stage === 1 ? "Filming shot 1 of 2…" : "Filming shot 2 of 2…"}
                <div className="mt-1 text-xs">Takes a few minutes. You can leave this page open.</div>
              </div>
            ) : (
              <Film className="h-10 w-10 text-muted-foreground" />
            )}
          </div>
          {r.status === "failed" && <p className="mt-2 text-sm text-destructive">{r.error}</p>}
          {(r.status === "scripted" || r.status === "failed") && (
            <Button className="w-full mt-3" onClick={onVideo} disabled={busy}>
              <Film className="h-4 w-4" /> {r.status === "failed" ? "Try video again" : "Generate POV video (~20s)"}
            </Button>
          )}
        </aside>
      </div>
    </div>
  );
}
