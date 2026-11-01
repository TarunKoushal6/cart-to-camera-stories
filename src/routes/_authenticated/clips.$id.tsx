import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, CalendarClock, CheckCircle2, Facebook, Film, Instagram, Loader2, Send, Youtube } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { approveClip, getStudioSettings, publishStudioClip, reviewClip, saveClipPlan } from "@/lib/studio.functions";
import { getYouTubeConnection, publishYouTubeClip, startYouTubeConnect } from "@/lib/youtube-publishing.functions";
import { viralReviewSchema } from "@/lib/clip-review-rules";
import { composeCaption, parsePostText, youtubeFields, type PostText } from "@/lib/post-text-rules";
import { stamp, studioHead } from "@/lib/studio-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/clips/$id")({
  head: () => studioHead("Publish clip", "Preview your vertical short, edit the caption and hashtags, and post to YouTube Shorts, Instagram Reels and Facebook Reels."),
  component: PublishStudio,
});

type PlatformId = "youtube" | "instagram" | "facebook";

function PublishStudio() {
  const { id } = Route.useParams(), qc = useQueryClient();
  const savePlan = useServerFn(saveClipPlan), approve = useServerFn(approveClip), review = useServerFn(reviewClip);
  const publishMeta = useServerFn(publishStudioClip), publishYT = useServerFn(publishYouTubeClip);
  const getSettings = useServerFn(getStudioSettings), getYT = useServerFn(getYouTubeConnection), connectYT = useServerFn(startYouTubeConnect);

  const { data: clip, isLoading, error } = useQuery({ queryKey: ["studio-clip", id], queryFn: async () => {
    const r = await supabase.from("studio_clips").select("*").eq("id", id).single(); if (r.error) throw r.error; return r.data; } });
  const { data: settings = [] } = useQuery({ queryKey: ["studio-settings"], queryFn: () => getSettings() });
  const { data: yt } = useQuery({ queryKey: ["youtube-connection"], queryFn: () => getYT() });
  const { data: ig } = useQuery({ queryKey: ["ig"], queryFn: async () => (await supabase.from("instagram_accounts").select("username, connected_at").maybeSingle()).data });

  const [text, setText] = useState<PostText>({ caption: "", description: "", hashtags: "" });
  const [selected, setSelected] = useState<Record<PlatformId, boolean>>({ youtube: true, instagram: true, facebook: true });
  const [privacy, setPrivacy] = useState<"public" | "unlisted" | "private">("public");
  const [when, setWhen] = useState(""), [busy, setBusy] = useState<"" | "now" | "schedule">(""), [videoUrl, setVideoUrl] = useState("");

  useEffect(() => { if (clip) setText(parsePostText(clip.caption, clip.title, clip.reason)); }, [clip?.id]);
  useEffect(() => { let active = true; setVideoUrl("");
    if (clip?.video_path) supabase.storage.from("videos").createSignedUrl(clip.video_path, 3600).then(r => { if (active) setVideoUrl(r.data?.signedUrl || ""); });
    return () => { active = false; }; }, [clip?.video_path]);

  if (isLoading) return <p className="text-muted-foreground">Loading clip…</p>;
  if (error || !clip) return <p className="text-destructive">Clip not found.</p>;

  const fb = settings.find(s => s.kind === "facebook");
  const platforms: { id: PlatformId; label: string; icon: typeof Youtube; connected: boolean; account?: string | null | undefined }[] = [
    { id: "youtube", label: "YouTube Shorts", icon: Youtube, connected: Boolean(yt?.channel), account: yt?.channel?.channel_name },
    { id: "instagram", label: "Instagram Reels", icon: Instagram, connected: Boolean(ig), account: ig?.username ? `@${ig.username}` : null },
    { id: "facebook", label: "Facebook Reels", icon: Facebook, connected: Boolean(fb), account: fb?.account_name },
  ];
  const targets = platforms.filter(p => p.connected && selected[p.id]);
  const critique = viralReviewSchema.safeParse(clip.viral_review);
  const ready = Boolean(clip.video_path);

  async function connectYouTube() {
    try { const r = await connectYT(); window.location.href = r.url; }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't start YouTube connection. Check YouTube setup in Settings."); }
  }

  async function post(mode: "now" | "schedule") {
    if (!clip || !targets.length) return;
    const scheduledAt = mode === "schedule" && when ? new Date(when).toISOString() : null;
    if (mode === "schedule" && (!scheduledAt || Date.parse(scheduledAt) <= Date.now())) { toast.error("Choose a future time to schedule."); return; }
    setBusy(mode);
    try {
      const caption = composeCaption(text);
      // Clicking Post/Schedule is the owner's explicit approval; the AI review must exist before approval.
      if (caption !== clip.caption) await savePlan({ data: { clipId: id, caption, voiceover: clip.voiceover || "" } });
      if (!critique.success) { toast.message("Running AI viral review first…"); await review({ data: { clipId: id } }); }
      await approve({ data: { clipId: id } });
      const results = await Promise.allSettled(targets.map(p => p.id === "youtube"
        ? publishYT({ data: { clipId: id, ...youtubeFields(text), privacy: scheduledAt ? "public" : privacy, scheduledAt, madeForKids: false } })
        : publishMeta({ data: { clipId: id, platform: p.id, caption, scheduledAt } })));
      results.forEach((r, i) => {
        const name = targets[i]!.label;
        if (r.status === "fulfilled") toast.success(scheduledAt ? `${name}: scheduled` : `${name}: posting started`);
        else toast.error(`${name}: ${r.reason instanceof Error ? r.reason.message : "failed"}`);
      });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't post this clip"); }
    finally { setBusy(""); qc.invalidateQueries({ queryKey: ["studio-clip", id] }); }
  }

  return <div>
    <Link to="/dashboard" className="inline-flex gap-2 items-center text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" />Dashboard</Link>
    <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
      <div><p className="studio-eyebrow">PUBLISH · {stamp(clip.start_seconds)} — {stamp(clip.end_seconds)} · {Math.round(clip.end_seconds - clip.start_seconds)}s · 9:16</p>
        <h1 className="font-display text-3xl font-bold mt-2">{clip.title}</h1></div>
      {critique.success && <span className={`text-sm font-medium ${critique.data.verdict === "Viral" ? "text-primary" : "text-accent"}`}>AI verdict: {critique.data.verdict} · Hook {critique.data.hook}</span>}
    </div>

    <div className="grid lg:grid-cols-[minmax(260px,360px)_1fr] gap-10 mt-8">
      <div>
        <div className="aspect-[9/16] w-full max-w-[360px] mx-auto bg-secondary overflow-hidden rounded-md border border-border">
          {videoUrl ? <video className="h-full w-full object-cover" src={videoUrl} controls playsInline aria-label="Clip preview" />
            : <div className="h-full flex flex-col justify-center items-center text-center p-6"><Film className="h-9 w-9 text-primary" />
              <p className="font-display text-xl mt-4">{ready ? "Loading video…" : "Not rendered yet"}</p>
              {!ready && <p className="text-sm text-muted-foreground mt-2">Use Auto Cut Viral Shorts on the dashboard to render this clip.</p>}</div>}
        </div>
      </div>

      <div className="space-y-8">
        <section className="space-y-4">
          <label className="text-sm block">Caption<Input aria-label="Caption" className="mt-2" value={text.caption} maxLength={150} onChange={e => setText({ ...text, caption: e.target.value })} placeholder="Hook line viewers see first" /></label>
          <label className="text-sm block">Description<Textarea aria-label="Description" className="mt-2" rows={4} maxLength={1800} value={text.description} onChange={e => setText({ ...text, description: e.target.value })} /></label>
          <label className="text-sm block">Hashtags<Input aria-label="Hashtags" className="mt-2" value={text.hashtags} onChange={e => setText({ ...text, hashtags: e.target.value })} placeholder="#shorts #reels" /></label>
          <p className="text-xs text-muted-foreground">YouTube uses the caption as the title. Instagram and Facebook get caption, description and hashtags together.</p>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold">Post to</h2>
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {platforms.map(p => <li key={p.id} className="flex items-center gap-3 py-3">
              <input type="checkbox" aria-label={`Post to ${p.label}`} className="h-4 w-4 accent-[var(--primary)]" disabled={!p.connected} checked={p.connected && selected[p.id]} onChange={e => setSelected({ ...selected, [p.id]: e.target.checked })} />
              <p.icon className="h-5 w-5" />
              <div className="flex-1 min-w-0"><p className="font-medium">{p.label}</p>{p.account && <p className="text-xs text-muted-foreground truncate">{p.account}</p>}</div>
              {p.connected
                ? <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary px-2.5 py-0.5 text-xs font-medium"><CheckCircle2 className="h-3 w-3" />Connected</span>
                : <span className="flex items-center gap-3"><span className="rounded-full bg-muted text-muted-foreground px-2.5 py-0.5 text-xs font-medium">Disconnected</span>
                  {p.id === "youtube" ? <Button size="sm" variant="outline" onClick={connectYouTube}>Connect</Button>
                    : <Button size="sm" variant="outline" asChild><Link to="/instagram">Connect</Link></Button>}</span>}
            </li>)}
          </ul>
          {selected.youtube && yt?.channel && <label className="text-sm mt-4 flex items-center gap-3">YouTube visibility
            <select aria-label="YouTube visibility" className="studio-select w-40" value={privacy} onChange={e => setPrivacy(e.target.value as typeof privacy)}>
              <option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option></select></label>}
        </section>

        <section className="space-y-4">
          <Button size="lg" className="w-full sm:w-auto h-12 px-8 text-base" disabled={!!busy || !ready || !targets.length} onClick={() => post("now")}>
            {busy === "now" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}{busy === "now" ? "Posting…" : `Post Now${targets.length ? ` to ${targets.length}` : ""}`}</Button>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">Or schedule for<Input aria-label="Schedule time" className="mt-2 w-60" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} /></label>
            <Button variant="outline" disabled={!!busy || !ready || !targets.length || !when} onClick={() => post("schedule")}>
              {busy === "schedule" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}Schedule</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {!ready ? "This clip has no rendered video yet." : !targets.length ? "Connect and tick at least one platform." : "Pressing Post Now or Schedule approves this clip. Nothing posts until you do."}
            {" "}<Link to="/schedule" className="underline">See posts</Link></p>
        </section>
      </div>
    </div>
  </div>;
}
