import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Cloud, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { startCloudCut, pollCloudCut, cloudCutProgress } from "@/lib/cloud-clipper.functions";
import { CLOUD_STEPS, cloudJobProgress } from "@/lib/cloud-clipper-rules";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

const ACTIVE = ["transcribing", "analyzing", "rendering", "finalizing"];

export function CloudCutButton({ url, sourceId }: { url: string; sourceId?: string }) {
  const start = useServerFn(startCloudCut), poll = useServerFn(pollCloudCut), readProgress = useServerFn(cloudCutProgress), qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [currentSourceId, setCurrentSourceId] = useState<string | null>(sourceId ?? null);
  const advancing = useRef(false);
  const scopeSource = sourceId ?? currentSourceId;

  // Track the job we just started; otherwise the latest job for this video, or (dashboard) the latest active job.
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
  const { data: live } = useQuery({ queryKey: ["cloud-progress", job?.id, job?.status], refetchInterval: 3000,
    enabled: Boolean(job && ["transcribing", "rendering"].includes(job.status)),
    queryFn: () => readProgress({ data: { jobId: job!.id } }) });
  const view = job ? cloudJobProgress(job.status, live) : null;

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
        qc.invalidateQueries({ queryKey: ["studio-clip-count"] }), qc.invalidateQueries({ queryKey: ["cloud-jobs"] })]);
    } catch (e) { if (manual) toast.error(e instanceof Error ? e.message : "Couldn't refresh cloud job"); }
    finally { advancing.current = false; if (manual) setBusy(false); }
  }

  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy || !url.trim() || active} type="button" onClick={async () => {
        setBusy(true);
        try {
          const r = await start({ data: { url, ...(sourceId ? { sourceId } : {}) } });
          setCurrentJobId(r.id); setCurrentSourceId(r.sourceId);
          await qc.invalidateQueries({ queryKey: ["studio-sources"] }); await qc.invalidateQueries({ queryKey: ["cloud-jobs"] });
          toast.success("Cloud clipping started — clips will await your approval");
        }
        catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't start cloud clipping"); }
        finally { setBusy(false); }
      }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}Fully Auto Cut with Cloud Worker</Button>
      {active && job && <Button size="icon" variant="ghost" aria-label="Refresh cloud clipping" title="Refresh cloud clipping" disabled={busy} onClick={() => advance(job.id, job.source_id, true)}><RefreshCw className="h-4 w-4" /></Button>}
    </div>
    {job && view && (job.status === "failed"
      ? <p className="text-xs text-destructive whitespace-pre-wrap break-words max-h-40 overflow-auto" role="status">{view.label}{job.error ? ` · ${job.error}` : ""}</p>
      : <div className="space-y-2 rounded-md border border-border bg-card p-3" role="status">
        <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {CLOUD_STEPS.map((s, i) => <li key={s} className={`flex items-center gap-1 ${i < view.step ? "text-muted-foreground" : i === view.step ? "text-foreground font-medium" : "text-muted-foreground/50"}`}>
            {i < view.step ? <Check className="h-3 w-3" /> : i === view.step ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="h-3 w-3 rounded-full border border-current" />}{s}
          </li>)}
        </ol>
        {view.percent != null ? <Progress value={view.percent} aria-label="Cloud clipping progress" /> : active && <Progress value={100} className="animate-pulse opacity-50" aria-label="Cloud worker working" />}
        <p className="text-xs text-muted-foreground tabular-nums">{view.label}{view.percent != null ? ` · ${Math.round(view.percent)}%` : ""}{view.detail ? ` · ${view.detail}` : ""}</p>
        {job.error && <p className="text-xs text-destructive whitespace-pre-wrap break-words">{job.error}</p>}
      </div>)}
  </div>;
}
