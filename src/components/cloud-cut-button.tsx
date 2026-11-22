import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Cloud, Download, Gauge, Loader2, Music, RefreshCw, Square, Timer, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { startCloudCut, pollCloudCut, cloudCutProgress, cancelCloudCut } from "@/lib/cloud-clipper.functions";
import { CLOUD_STEPS, cloudJobProgress, downloadStats, isStoppedJob, MUSIC_MODES, wantsOutro, type MusicMode } from "@/lib/cloud-clipper-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";

const ACTIVE = ["transcribing", "analyzing", "rendering", "finalizing"];

/** Starts cloud jobs and tracks the newest one (for a video, or the latest active job). */
function useCloudCut(sourceId?: string) {
  const start = useServerFn(startCloudCut), poll = useServerFn(pollCloudCut), readProgress = useServerFn(cloudCutProgress), cancel = useServerFn(cancelCloudCut), qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [currentSourceId, setCurrentSourceId] = useState<string | null>(sourceId ?? null);
  const advancing = useRef(false);
  const scopeSource = sourceId ?? currentSourceId;

  const { data: job } = useQuery({ queryKey: ["cloud-jobs", scopeSource ?? "latest", currentJobId], refetchInterval: 3000,
    queryFn: async () => {
      let q = supabase.from("studio_cloud_jobs").select("id,status,error,source_id,created_at");
      if (currentJobId) q = q.eq("id", currentJobId);
      else if (scopeSource) q = q.eq("source_id", scopeSource);
      else q = q.in("status", ACTIVE);
      const r = await q.order("created_at", { ascending: false }).limit(1);
      if (r.error) throw r.error;
      return r.data[0] ?? null;
    } });
  const active = Boolean(job && ACTIVE.includes(job.status));
  const shownSkip = useRef<string | null>(null);
  useEffect(() => {
    if (job?.status === "failed" && job.error?.includes("NO_CAPTIONS") && shownSkip.current !== job.id) {
      shownSkip.current = job.id;
      toast.error("No Hindi/English captions were retrieved", { description: "This does not confirm that captions are absent. If CC is visible on YouTube, check the worker error below; it may be blocked or outdated.", duration: 15000 });
    }
  }, [job?.id, job?.status]);
  const { data: live } = useQuery({ queryKey: ["cloud-progress", job?.id, job?.status], refetchInterval: 3000,
    enabled: Boolean(job && ["transcribing", "rendering"].includes(job.status)),
    queryFn: () => readProgress({ data: { jobId: job!.id } }) });

  useEffect(() => {
    if (!active || !job) return;
    void advance(job.id, job.source_id);
    const interval = setInterval(() => { void advance(job.id, job.source_id); }, 6000);
    return () => clearInterval(interval);
  }, [job?.id, active]);

  async function advance(jobId: string, src: string, manual = false) {
    if (advancing.current) return;
    advancing.current = true;
    if (manual) setBusy(true);
    try {
      await poll({ data: { jobId } });
      await Promise.all([qc.invalidateQueries({ queryKey: ["studio-clips", src] }), qc.invalidateQueries({ queryKey: ["studio-sources"] }),
        qc.invalidateQueries({ queryKey: ["studio-clip-count"] }), qc.invalidateQueries({ queryKey: ["ready-clips"] }), qc.invalidateQueries({ queryKey: ["cloud-jobs"] })]);
    } catch (e) { if (manual) toast.error(e instanceof Error ? e.message : "Couldn't refresh cloud job"); }
    finally { advancing.current = false; if (manual) setBusy(false); }
  }

  async function begin(url: string, music: MusicMode = "auto", outro = true) {
    setBusy(true);
    try {
      const r = await start({ data: { url, music, outro, ...(sourceId ? { sourceId } : {}) } });
      setCurrentJobId(r.id); setCurrentSourceId(r.sourceId);
      await qc.invalidateQueries({ queryKey: ["studio-sources"] }); await qc.invalidateQueries({ queryKey: ["cloud-jobs"] });
      toast.success("Auto cut started — clips will wait for your approval");
      return true;
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't start auto cut"); return false; }
    finally { setBusy(false); }
  }

  const [stopping, setStopping] = useState(false);
  async function stop() {
    if (!job || !window.confirm("Stop this auto cut? Clips already saved stay in your library.")) return;
    setStopping(true);
    try {
      await cancel({ data: { jobId: job.id } });
      setCurrentJobId(job.id); // keep showing this run as "Stopped" instead of hiding it
      await qc.invalidateQueries({ queryKey: ["cloud-jobs"] });
      toast.success("Auto cut stopped");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't stop auto cut"); }
    finally { setStopping(false); }
  }

  return { job, live, active, busy, stopping, begin, stop, refresh: () => job && advance(job.id, job.source_id, true) };
}

type CloudState = ReturnType<typeof useCloudCut>;

function CloudProgress({ state }: { state: CloudState }) {
  const { job, live, active, busy, stopping, stop, refresh } = state;
  if (!job) return null;
  if (isStoppedJob(job.status, job.error)) return <div className="rounded-lg border border-border bg-background/60 p-4" role="status">
    <p className="text-sm font-medium">Auto cut stopped</p>
    <p className="text-xs text-muted-foreground mt-1">{job.error}</p>
  </div>;
  const view = cloudJobProgress(job.status, live);
  const dl = downloadStats(live);
  if (job.status === "failed") return <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4" role="status">
    <p className="text-sm font-medium text-destructive">{view.label}</p>
    {job.error && <p className="text-xs text-destructive/90 whitespace-pre-wrap break-words max-h-40 overflow-auto mt-1">{job.error}</p>}
  </div>;
  return <div className="rounded-lg border border-border bg-background/60 p-4 space-y-4" role="status">
    <ol className="grid grid-cols-5 gap-2" aria-label="Auto cut stages">
      {CLOUD_STEPS.map((s, i) => {
        const done = i < view.step || (i === CLOUD_STEPS.length - 1 && job.status === "ready"), current = i === view.step;
        return <li key={s} className="flex flex-col gap-2 min-w-0">
          <span className={`h-1 rounded-full ${done ? "bg-primary" : current ? "bg-primary/50 animate-pulse" : "bg-muted"}`} />
          <span className={`flex items-start gap-1.5 text-[11px] leading-tight ${done ? "text-muted-foreground" : current ? "text-foreground font-medium" : "text-muted-foreground/50"}`}>
            <span className="shrink-0 mt-px">{done ? <Check className="h-3 w-3 text-primary" /> : current ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="block h-3 w-3 rounded-full border border-current" />}</span>
            <span className="hidden sm:inline">{i + 1}. {s}</span><span className="sm:hidden">{i + 1}</span>
          </span>
        </li>;
      })}
    </ol>
    <div className="flex items-baseline justify-between gap-3">
      <p className="font-medium text-sm">{view.label}</p>
      <div className="flex items-center gap-2">
        {view.percent != null && <span className="font-display text-2xl font-bold tabular-nums text-primary">{Math.round(view.percent)}%</span>}
        {active && <Button size="sm" variant="outline" disabled={stopping} onClick={() => stop()} className="text-destructive border-destructive/40 hover:bg-destructive/10">
          {stopping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}Stop
        </Button>}
        {active && <Button size="icon" variant="ghost" aria-label="Refresh progress" title="Refresh progress" disabled={busy} onClick={() => refresh()}><RefreshCw className="h-4 w-4" /></Button>}
      </div>
    </div>
    {view.percent != null ? <Progress value={view.percent} aria-label="Auto cut progress" /> : active && <Progress value={100} className="animate-pulse opacity-50" aria-label="Worker busy" />}
    {dl ? <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Stat icon={Download} label="Downloaded" value={dl.size} />
      <Stat icon={Gauge} label="Speed" value={dl.speed ?? "—"} />
      <Stat icon={Timer} label="Time left" value={dl.eta ?? "—"} />
    </dl> : view.detail && <p className="text-xs text-muted-foreground tabular-nums">{view.detail}</p>}
    {job.error && <p className="text-xs text-destructive whitespace-pre-wrap break-words">{job.error}</p>}
  </div>;
}

function Stat({ icon: Icon, label, value }: { icon: typeof Download; label: string; value: string }) {
  return <div className="rounded-md bg-card border border-border px-3 py-2">
    <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Icon className="h-3 w-3" />{label}</dt>
    <dd className="font-display font-bold tabular-nums mt-0.5">{value}</dd>
  </div>;
}

const MUSIC_LABELS: Record<MusicMode, string> = { auto: "Auto — match each clip's vibe", off: "Off — original audio only", energetic: "Energetic",
  chill: "Chill", emotional: "Emotional", dramatic: "Dramatic", inspiring: "Inspiring", funny: "Funny" };

/** Dashboard hero: paste a link, one action, live progress below. */
export function AutoCutCard() {
  const state = useCloudCut();
  const [url, setUrl] = useState(""), [music, setMusic] = useState<MusicMode>("auto");
  const [outro, setOutro] = useState(true), [outroAllowed, setOutroAllowed] = useState(false);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setOutroAllowed(wantsOutro(data.user?.email))); }, []);
  return <section className="rounded-xl border border-border bg-card p-5 sm:p-7 space-y-5">
    <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); if (await state.begin(url, music, outro)) setUrl(""); }}>
    <div className="flex flex-col sm:flex-row gap-3">
      <Input aria-label="YouTube URL" placeholder="Paste a YouTube link — https://www.youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} type="url" required className="h-14 text-base bg-background" />
      <Button size="lg" disabled={state.busy || state.active} className="h-14 px-7 shrink-0 font-semibold">
        {state.busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5" />}{state.active ? "Cutting…" : "Auto Cut Viral Shorts"}
      </Button>
    </div>
    <label className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><Music className="h-4 w-4 text-primary" />Background music
      <select aria-label="Background music" className="studio-select" style={{ width: "auto", height: 36 }} value={music} onChange={(e) => setMusic(e.target.value as MusicMode)}>
        {MUSIC_MODES.map((m) => <option key={m} value={m}>{MUSIC_LABELS[m]}</option>)}
      </select>
      <span className="text-xs">Royalty-free, kept quiet and lowered automatically whenever someone speaks. No voiceover.</span>
    </label>
    {outroAllowed && <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <input type="checkbox" aria-label="Add outro" checked={outro} onChange={(e) => setOutro(e.target.checked)} className="h-4 w-4 accent-primary" />
      Add outro at the end of each reel
    </label>}
    </form>
    <p className="text-xs text-muted-foreground">Downloads the video, finds every strong moment, cuts 9:16 shorts with burned-in captions and saves them below. Nothing posts until you approve it. Only use videos you own or have permission to repurpose.</p>
    <CloudProgress state={state} />
  </section>;
}

/** Compact re-run control for an existing source video. */
export function CloudCutButton({ url, sourceId }: { url: string; sourceId?: string }) {
  const state = useCloudCut(sourceId);
  return <div className="space-y-2">
    <Button variant="outline" disabled={state.busy || !url.trim() || state.active} type="button" onClick={() => state.begin(url)}>
      {state.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}Auto Cut Viral Shorts
    </Button>
    <CloudProgress state={state} />
  </div>;
}
