import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, Facebook, Film, Instagram, Loader2, RotateCcw, Send, Youtube } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { approveClip, getPublishStatus, getStudioSettings, publishStudioClip, saveClipPlan } from "@/lib/studio.functions";
import { PHASES, isFinalPhase, needsReconnect, phasePercent, publishPhase, type PublishPhase } from "@/lib/publish-progress-rules";
import { Progress } from "@/components/ui/progress";
import { getYouTubeConnection, publishYouTubeClip } from "@/lib/youtube-publishing.functions";
import { useYouTubeConnect } from "@/components/youtube-connection";
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
type Run = { postId?: string | undefined; phase: PublishPhase; error?: string | undefined; at?: string | null | undefined };
const errText = (e: unknown) => e instanceof Error ? e.message : "Publishing failed";

function PublishStudio() {
  const { id } = Route.useParams(), qc = useQueryClient();
  const savePlan = useServerFn(saveClipPlan), approve = useServerFn(approveClip);
  const publishMeta = useServerFn(publishStudioClip), publishYT = useServerFn(publishYouTubeClip);
  const getSettings = useServerFn(getStudioSettings), getYT = useServerFn(getYouTubeConnection);
  const ytConnect = useYouTubeConnect(), pollStatus = useServerFn(getPublishStatus);
  const [runs, setRuns] = useState<Partial<Record<PlatformId, Run>>>({});
  const pending = (Object.entries(runs) as [PlatformId, Run][]).filter(([, r]) => r.postId && !isFinalPhase(r.phase));
  const startedAt = useRef(0);

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

  // Poll only this page's posts every 4s until each one is published, scheduled or failed (stops after 15 min).
  const pendingKey = pending.map(([k, r]) => `${k}:${r.postId}`).join(",");
  useEffect(() => {
    if (!pendingKey) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      if (Date.now() - startedAt.current > 15 * 60_000) return;
      const list = pendingKey.split(",").map(x => x.split(":") as [PlatformId, string]);
      try {
        const r = await pollStatus({ data: { meta: list.filter(([k]) => k !== "youtube").map(([, id]) => id), youtube: list.filter(([k]) => k === "youtube").map(([, id]) => id) } });
        if (stop) return;
        setRuns(prev => { const next = { ...prev };
          for (const [k, id] of list) { const row = (k === "youtube" ? r.youtube : r.meta).find(x => x.id === id);
            if (row) next[k] = { postId: id, phase: publishPhase(row), error: row.error || undefined, at: row.scheduled_at }; }
          return next; });
      } catch { /* transient; next tick retries */ }
      if (!stop) timer = setTimeout(tick, 4000);
    };
    let timer = setTimeout(tick, 2500);
    return () => { stop = true; clearTimeout(timer); };
  }, [pendingKey]);

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

  async function prepare(caption: string) {
    // Clicking Post/Schedule/Retry is the owner's explicit approval; no AI review is required.
    if (!clip) return;
    if (caption !== clip.caption) await savePlan({ data: { clipId: id, caption, voiceover: clip.voiceover || "" } });
    await approve({ data: { clipId: id } });
  }

  async function postOne(pid: PlatformId, caption: string, scheduledAt: string | null) {
    setRuns(prev => ({ ...prev, [pid]: { phase: "uploading" } }));
    try {
      const r = pid === "youtube"
        ? await publishYT({ data: { clipId: id, ...youtubeFields(text), privacy: scheduledAt ? "public" : privacy, scheduledAt, madeForKids: false } })
        : await publishMeta({ data: { clipId: id, platform: pid, caption, scheduledAt } });
      const phase: PublishPhase = scheduledAt && pid !== "youtube" ? "scheduled" : "processing";
      setRuns(prev => ({ ...prev, [pid]: { postId: r.id, phase, at: scheduledAt } }));
    } catch (e) { setRuns(prev => ({ ...prev, [pid]: { phase: "failed", error: errText(e) } })); }
  }

  async function post(mode: "now" | "schedule") {
    if (!clip || !targets.length) return;
    const scheduledAt = mode === "schedule" && when ? new Date(when).toISOString() : null;
    if (mode === "schedule" && (!scheduledAt || Date.parse(scheduledAt) <= Date.now())) { toast.error("Choose a future time to schedule."); return; }
    setBusy(mode); startedAt.current = Date.now();
    const caption = composeCaption(text);
    setRuns(Object.fromEntries(targets.map(p => [p.id, { phase: "uploading" } as Run])));
    try {
      await prepare(caption);
      await Promise.all(targets.map(p => postOne(p.id, caption, scheduledAt)));
    } catch (e) {
      const message = errText(e);
      setRuns(Object.fromEntries(targets.map(p => [p.id, { phase: "failed", error: message } as Run])));
    } finally { setBusy(""); qc.invalidateQueries({ queryKey: ["studio-clip", id] }); }
  }

  async function retry(pid: PlatformId) {
    const caption = composeCaption(text); startedAt.current = Date.now();
    try { await prepare(caption); await postOne(pid, caption, null); }
    catch (e) { setRuns(prev => ({ ...prev, [pid]: { phase: "failed", error: errText(e) } })); }
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
                  {p.id === "youtube" ? (yt?.configured === false ? <Button size="sm" variant="outline" asChild><Link to="/settings">Set up</Link></Button> : <Button size="sm" variant="outline" disabled={ytConnect.busy} onClick={ytConnect.connect}>{ytConnect.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Connect"}</Button>)
                    : <Button size="sm" variant="outline" asChild><Link to="/instagram">Connect</Link></Button>}</span>}
            </li>)}
          </ul>
          {selected.youtube && yt?.channel && <label className="text-sm mt-4 flex items-center gap-3">YouTube visibility
            <select aria-label="YouTube visibility" className="studio-select w-40" value={privacy} onChange={e => setPrivacy(e.target.value as typeof privacy)}>
              <option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option></select></label>}
        </section>

        {Object.keys(runs).length > 0 && <section aria-label="Publishing status" className="space-y-3">
          <h2 className="font-display text-lg font-bold">Publishing status</h2>
          {platforms.filter(p => runs[p.id]).map(p => <PublishStatus key={p.id} label={p.label} icon={p.icon} run={runs[p.id]!}
            onRetry={() => retry(p.id)}
            reconnect={p.id === "youtube" ? <Button size="sm" variant="outline" disabled={ytConnect.busy} onClick={ytConnect.connect}>Reconnect YouTube</Button>
              : <Button size="sm" variant="outline" asChild><Link to={p.id === "instagram" ? "/instagram" : "/settings"}>Reconnect {p.id === "instagram" ? "Instagram" : "Facebook"}</Link></Button>} />)}
        </section>}

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

function PublishStatus({ label, icon: Icon, run, onRetry, reconnect }: { label: string; icon: typeof Youtube; run: Run; onRetry: () => void; reconnect: ReactNode }) {
  if (run.phase === "published") return <div role="status" className="rounded-md border border-success/50 bg-success/15 p-4 flex gap-3">
    <CheckCircle2 className="h-6 w-6 text-success shrink-0" /><div><p className="font-semibold text-success">{label}: published</p>
      <p className="text-sm text-muted-foreground mt-1">Your clip is live. Views and likes appear in Analytics within a few hours.</p></div></div>;
  if (run.phase === "scheduled") return <div role="status" className="rounded-md border border-success/50 bg-success/15 p-4 flex gap-3">
    <CalendarClock className="h-6 w-6 text-success shrink-0" /><div><p className="font-semibold text-success">{label}: scheduled</p>
      <p className="text-sm text-muted-foreground mt-1">{run.at ? `Goes live ${new Date(run.at).toLocaleString()}.` : "Queued for its scheduled time."}</p></div></div>;
  if (run.phase === "failed") return <div role="alert" className="rounded-md border border-destructive/60 bg-destructive/15 p-4 flex gap-3">
    <AlertTriangle className="h-6 w-6 text-destructive shrink-0" /><div className="min-w-0 flex-1"><p className="font-semibold text-destructive">{label}: posting failed</p>
      <p className="text-sm mt-1 break-words">{run.error || "The platform rejected this post."}</p>
      <div className="flex flex-wrap gap-2 mt-3">{needsReconnect(run.error) && reconnect}
        <Button size="sm" variant="outline" onClick={onRetry}><RotateCcw className="h-4 w-4" />Retry</Button></div></div></div>;
  const idx = run.phase === "uploading" ? 0 : 1;
  return <div className="rounded-md border border-border bg-card p-4">
    <div className="flex items-center gap-2"><Icon className="h-5 w-5" /><p className="font-medium flex-1">{label}</p>
      <span className="text-sm text-muted-foreground inline-flex items-center gap-1.5"><Loader2 className="h-4 w-4 animate-spin" />{PHASES[idx]!.label}…</span></div>
    <Progress value={phasePercent(run.phase)} className="mt-3 h-2" aria-label={`${label} progress`} />
    <ol className="mt-2 grid grid-cols-3 text-xs">
      {PHASES.map((s, i) => <li key={s.id} className={`${i === 1 ? "text-center" : i === 2 ? "text-right" : ""} ${i <= idx ? "text-foreground font-medium" : "text-muted-foreground"}`}>{s.label}</li>)}
    </ol>
    {run.phase === "processing" && <p className="text-xs text-muted-foreground mt-2">The platform is processing your video. This usually takes 1–5 minutes; you can leave this page.</p>}
  </div>;
}
