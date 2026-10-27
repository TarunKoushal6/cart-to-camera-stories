import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Wand2, CalendarCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { analyzeSource, attachStudioVideo, reviewClip, approveClip, publishStudioClip } from "@/lib/studio.functions";
import { clipCues, nextDaySlots, type Cue } from "@/lib/studio-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Clip = Database["public"]["Tables"]["studio_clips"]["Row"];
type Review = { verdict?: string; hook?: number; critique?: string } | null;

/** Browser batch: find moments → render 9:16 captioned MP4s → save → AI review; the owner then approves to schedule for tomorrow. */
export function BatchClipper({ sourceId, cues, clips }: { sourceId: string; cues: Cue[]; clips: Clip[] }) {
  const qc = useQueryClient();
  const analyze = useServerFn(analyzeSource), attach = useServerFn(attachStudioVideo), review = useServerFn(reviewClip), approve = useServerFn(approveClip), publish = useServerFn(publishStudioClip);
  const [file, setFile] = useState<File | null>(null), [status, setStatus] = useState(""), [busy, setBusy] = useState(false);
  const [platform, setPlatform] = useState<"instagram" | "facebook">("instagram"), [picked, setPicked] = useState<string[]>([]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["studio-clips", sourceId] });
  const pending = clips.filter(c => c.video_path && c.viral_review);

  async function runBatch() {
    if (!file) { toast.error("Choose the source video file first."); return; }
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sign in first.");
      const ownerId = auth.user.id;
      if (!clips.length) { setStatus("Finding viral moments…"); await analyze({ data: { sourceId } }); }
      const r = await supabase.from("studio_clips").select("*").eq("source_id", sourceId).order("score", { ascending: false });
      if (r.error) throw r.error;
      const todo = r.data.filter(c => !c.video_path);
      const { renderClip } = await import("@/lib/caption-render");
      for (const [i, c] of todo.entries()) {
        await renderClip(file, c.start_seconds, c.end_seconds, clipCues(cues, c.start_seconds, c.end_seconds), "karaoke", "center", n => setStatus(`Rendering ${i + 1}/${todo.length} · ${n}%`)).then(async out => {
          const path = `${ownerId}/clips/${c.id}/${crypto.randomUUID()}.mp4`;
          setStatus(`Saving ${i + 1}/${todo.length}…`);
          const up = await supabase.storage.from("videos").upload(path, out, { contentType: "video/mp4" });
          if (up.error) throw up.error;
          await attach({ data: { clipId: c.id, path, caption: c.caption } });
        });
        refresh();
      }
      const toReview = (await supabase.from("studio_clips").select("id").eq("source_id", sourceId).not("video_path", "is", null).is("viral_review", null)).data || [];
      for (const [i, c] of toReview.entries()) { setStatus(`AI reviewing ${i + 1}/${toReview.length}…`); try { await review({ data: { clipId: c.id } }); } catch (e) { toast.error(e instanceof Error ? e.message : "Review failed"); } }
      toast.success("Batch ready — review and approve below.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Batch failed"); }
    finally { setBusy(false); setStatus(""); refresh(); }
  }

  async function approveAndSchedule(ids: string[]) {
    setBusy(true);
    const succeeded: string[] = [], failed: string[] = [];
    try {
      const existing = await supabase.from("studio_posts").select("clip_id,scheduled_at").eq("platform", platform).in("clip_id", ids).in("status", ["scheduled", "processing", "published"]);
      if (existing.error) throw existing.error;
      const queued = new Set(existing.data.map(p => p.clip_id));
      const remaining = ids.filter(id => !queued.has(id));
      const slots = nextDaySlots(remaining.length);
      succeeded.push(...ids.filter(id => queued.has(id)));
      for (const [i, id] of remaining.entries()) {
        try {
        const c = clips.find(x => x.id === id);
        const slot = slots[i];
        if (!c || !slot) throw new Error("Clip no longer available. Refresh and select again.");
        if (!c.approved_at) await approve({ data: { clipId: id } });
        await publish({ data: { clipId: id, platform, caption: c.caption, scheduledAt: slot.toISOString() } });
        succeeded.push(id);
        } catch { failed.push(id); }
      }
      if (succeeded.length) toast.success(`${succeeded.length} clip(s) queued; existing posts were not duplicated`);
      if (failed.length) toast.error(`${failed.length} clip(s) couldn't be scheduled. They remain selected for retry.`);
      setPicked(failed);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't schedule"); }
    finally { setBusy(false); refresh(); }
  }

  return <section className="mt-5 border border-border rounded-md p-4 bg-card space-y-3">
    <h3 className="font-medium flex items-center gap-2"><Wand2 className="h-4 w-4 text-primary" />Auto batch clipping</h3>
    <p className="text-xs text-muted-foreground">Pick this video's MP4. Your AI finds every 20–30s moment, then each is cut to 9:16 with karaoke captions, saved to the cloud and AI-reviewed. Keep this tab open while it runs.</p>
    <div className="flex flex-wrap gap-2 items-center">
      <Input aria-label="Source video file" type="file" accept="video/mp4" className="max-w-xs" disabled={busy} onChange={e => setFile(e.target.files?.[0] || null)} />
      <Button size="sm" disabled={busy || !file} onClick={runBatch}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}Auto-clip all</Button>
    </div>
    {status && <p className="text-sm text-primary" role="status">{status}</p>}
    {!!pending.length && <div className="border-t border-border pt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 justify-between"><span className="text-sm font-medium">Awaiting your approval ({pending.length})</span>
        <div className="flex gap-2"><select aria-label="Batch platform" className="studio-select" value={platform} onChange={e => setPlatform(e.target.value as "instagram" | "facebook")}><option value="instagram">Instagram Reels</option><option value="facebook">Facebook Reels</option></select>
          <Button size="sm" disabled={busy || !picked.length} onClick={() => approveAndSchedule(picked)}><CalendarCheck className="h-4 w-4" />Approve & schedule tomorrow ({picked.length})</Button></div></div>
      {pending.map(c => { const r = c.viral_review as Review; return <label key={c.id} className="flex gap-3 items-start text-sm border border-border rounded p-2">
        <input type="checkbox" disabled={busy} checked={picked.includes(c.id)} onChange={e => setPicked(p => e.target.checked ? [...p, c.id] : p.filter(x => x !== c.id))} />
        <span className="min-w-0"><b>{c.title}</b> · <span className={r?.verdict === "Viral" ? "text-primary" : "text-muted-foreground"}>{r?.verdict} · hook {r?.hook}</span><span className="block text-xs text-muted-foreground line-clamp-2">{r?.critique}</span></span>
      </label>; })}
    </div>}
  </section>;
}
