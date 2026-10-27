import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { startCloudCut, pollCloudCut } from "@/lib/cloud-clipper.functions";
import { cloudStage } from "@/lib/cloud-clipper-rules";
import { Button } from "@/components/ui/button";

export function CloudCutButton({ url, sourceId }: { url: string; sourceId?: string }) {
  const start = useServerFn(startCloudCut), poll = useServerFn(pollCloudCut), qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { data: jobs = [] } = useQuery({ queryKey: ["cloud-jobs", sourceId], enabled: Boolean(sourceId), refetchInterval: 10000,
    queryFn: async () => {
      if (!sourceId) return [];
      const r = await supabase.from("studio_cloud_jobs").select("id,status,error").eq("source_id", sourceId).order("created_at", { ascending: false }).limit(1);
      if (r.error) throw r.error;
      return r.data;
    } });
  const job = jobs[0], active = job && !["ready", "failed"].includes(job.status);
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => { void refresh(); }, 15000);
    return () => clearInterval(interval);
  }, [job?.id, active, busy]);
  async function refresh() {
    if (!job || busy) return;
    setBusy(true);
    try { await poll({ data: { jobId: job.id } }); await Promise.all([qc.invalidateQueries({ queryKey: ["studio-clips", sourceId] }), qc.invalidateQueries({ queryKey: ["studio-sources"] }), qc.invalidateQueries({ queryKey: ["studio-clip-count"] })]); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't refresh cloud job"); }
    finally { setBusy(false); await qc.invalidateQueries({ queryKey: ["cloud-jobs", sourceId] }); }
  }
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy || !url.trim() || Boolean(active)} type="button" onClick={async () => {
        setBusy(true);
        try { await start({ data: { url, ...(sourceId ? { sourceId } : {}) } }); await qc.invalidateQueries({ queryKey: ["studio-sources"] }); await qc.invalidateQueries({ queryKey: ["cloud-jobs"] }); toast.success("Cloud clipping started — clips will await your approval"); }
        catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't start cloud clipping"); }
        finally { setBusy(false); }
      }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}Fully Auto Cut with Cloud Worker</Button>
      {active && <Button size="icon" variant="ghost" aria-label="Refresh cloud clipping" title="Refresh cloud clipping" disabled={busy} onClick={refresh}><RefreshCw className="h-4 w-4" /></Button>}
    </div>
    {job && <p className={`text-xs ${job.status === "failed" ? "text-destructive" : "text-muted-foreground"}`} role="status">{cloudStage(job.status)}{job.error ? ` · ${job.error}` : ""}</p>}
  </div>;
}