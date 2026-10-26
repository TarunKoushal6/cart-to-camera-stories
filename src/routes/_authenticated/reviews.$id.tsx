import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Film, Send, CalendarClock, Upload, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { startVideo, pollVideo, schedulePost, saveReview, finishVideoUpload } from "@/lib/ugc.functions";
import { validateVideoFile } from "@/lib/ugc-rules";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/reviews/$id")({
  head: () => ({
    meta: [
      { title: "Legacy product review — Cutline" },
      { name: "description", content: "Script, video and posting for a POV product review." },
      { property: "og:title", content: "Legacy product review — Cutline" },
      { property: "og:description", content: "Script, video and posting for a POV product review." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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
  const save = useServerFn(saveReview);
  const finishUpload = useServerFn(finishVideoUpload);
  const [busy, setBusy] = useState(false);
  const [caption, setCaption] = useState<string | null>(null);
  const [hashtags, setHashtags] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ vo1: string; vo2: string; scene1: string; scene2: string } | null>(null);
  const [uploading, setUploading] = useState(false);
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
  const edited = draft ?? { vo1: vo1 ?? "", vo2, scene1: r.scene_1, scene2: r.scene_2 };
  const captionText = caption ?? r.caption;
  const hashtagText = hashtags ?? r.hashtags;
  const cap = `${captionText}\n\n${hashtagText}`.trim();
  const silent = r.script_mode === "actions" || r.script_mode === "upload";

  async function persist() {
    await save({ data: { reviewId: id, voiceover1: edited.vo1, voiceover2: edited.vo2, scene1: edited.scene1, scene2: edited.scene2, caption: captionText, hashtags: hashtagText } });
  }

  async function onSave() {
    setBusy(true);
    try { await persist(); await qc.invalidateQueries({ queryKey: ["review", id] }); toast.success("Review saved"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't save review"); }
    finally { setBusy(false); }
  }

  async function onUpload(file?: File) {
    if (!file) return;
    setUploading(true);
    let path: string | null = null;
    let attached = false;
    try {
      validateVideoFile(file);
      await persist();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Please sign in again.");
      path = `${userData.user.id}/${id}/${crypto.randomUUID()}.mp4`;
      const { error } = await supabase.storage.from("videos").upload(path, file, { contentType: "video/mp4" });
      if (error) throw new Error(error.message);
      await finishUpload({ data: { reviewId: id, path } });
      attached = true;
      await qc.invalidateQueries({ queryKey: ["review", id] });
      toast.success("Video uploaded — ready to post");
    } catch (e) {
      if (path && !attached) await supabase.storage.from("videos").remove([path]);
      toast.error(e instanceof Error ? e.message : "Couldn't upload video");
    } finally { setUploading(false); }
  }

  async function onVideo() {
    setBusy(true);
    try {
      await persist();
      await start({ data: { reviewId: id } });
      qc.invalidateQueries({ queryKey: ["review", id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the video");
    } finally {
      setBusy(false);
    }
  }

  async function onPost(scheduled: boolean) {
    if (scheduled && !when) { toast.error("Pick a date and time"); return; }
    setBusy(true);
    try {
      await persist();
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
       {r.hook && <p className="mt-2 text-xl text-primary font-display">“{r.hook}”</p>}
       <p className="mt-2 text-sm text-muted-foreground">{r.script_mode === "actions" ? "No script / Actions only · No voiceover" : r.script_mode === "upload" ? "External video" : r.language === "hindi_hinglish" ? "Hindi / Hinglish" : "English"}</p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
           {r.script_mode !== "upload" && [{ n: "0–10s", vo: edited.vo1, sc: edited.scene1, voKey: "vo1" as const, scKey: "scene1" as const }, { n: "10–20s", vo: edited.vo2, sc: edited.scene2, voKey: "vo2" as const, scKey: "scene2" as const }].map((s) => (
            <section key={s.n} className="rounded-xl border border-border bg-card p-5">
              <div className="font-display text-sm text-primary">{s.n}</div>
               {!silent && <><Label htmlFor={`vo-${s.voKey}`} className="mt-2">Voiceover</Label><Textarea id={`vo-${s.voKey}`} className="mt-2" value={s.vo} maxLength={5000} disabled={busy || uploading || r.status === "rendering"} onChange={(e) => setDraft({ ...edited, [s.voKey]: e.target.value })} /></>}
               <Label htmlFor={`sc-${s.scKey}`} className="mt-4">POV shot · Hand actions</Label>
               <Textarea id={`sc-${s.scKey}`} className="mt-2" value={s.sc} maxLength={5000} disabled={busy || uploading || r.status === "rendering"} onChange={(e) => setDraft({ ...edited, [s.scKey]: e.target.value })} />
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
             <Label htmlFor="review-caption" className="mt-3">Caption</Label>
             <Textarea id="review-caption" className="mt-2" rows={4} maxLength={2200} value={captionText} onChange={(e) => setCaption(e.target.value)} />
             <Label htmlFor="review-hashtags" className="mt-3">Hashtags</Label>
             <Textarea id="review-hashtags" className="mt-2" rows={2} maxLength={2200} value={hashtagText} onChange={(e) => setHashtags(e.target.value)} />
             <p className={`mt-1 text-xs ${cap.length > 2200 ? "text-destructive" : "text-muted-foreground"}`}>{cap.length} / 2,200</p>
             <Button className="mt-3" variant="outline" onClick={onSave} disabled={busy || uploading || r.status === "rendering" || cap.length > 2200}><Save className="h-4 w-4" />Save review</Button>
            <div className="mt-3 flex flex-wrap gap-2 items-center">
               <Button disabled={busy || uploading || cap.length > 2200 || r.status !== "ready" || !ig} onClick={() => onPost(false)}>
                <Send className="h-4 w-4" /> Post now
              </Button>
               <Input type="datetime-local" aria-label="Schedule date and time" className="w-auto max-w-full" value={when} onChange={(e) => setWhen(e.target.value)} />
               <Button variant="secondary" disabled={busy || uploading || cap.length > 2200 || r.status !== "ready" || !ig} onClick={() => onPost(true)}>
                <CalendarClock className="h-4 w-4" /> Schedule
              </Button>
            </div>
             {r.status !== "ready" && <p className="mt-2 text-xs text-muted-foreground">No video attached yet.</p>}
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
           {r.script_mode !== "upload" && (r.status === "scripted" || r.status === "failed") && (
             <Button className="w-full mt-3" onClick={onVideo} disabled={busy || uploading}>
              <Film className="h-4 w-4" /> {r.status === "failed" ? "Try video again" : "Generate POV video (~20s)"}
            </Button>
          )}
           <div className="mt-4 space-y-2">
             <Label htmlFor="external-video" className="flex items-center gap-2"><Upload className="h-4 w-4" />{r.video_path ? "Replace with external video" : "Upload external video"}</Label>
             <Input id="external-video" type="file" accept=".mp4,video/mp4" disabled={busy || uploading || r.status === "rendering"} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void onUpload(file); }} />
             <p className="text-xs text-muted-foreground">{uploading ? "Uploading…" : "MP4 · Up to 50 MB"}</p>
           </div>
        </aside>
      </div>
    </div>
  );
}
