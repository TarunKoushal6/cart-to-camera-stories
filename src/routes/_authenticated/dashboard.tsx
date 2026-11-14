import type { MouseEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Film, KeyRound, Trash2, Clapperboard, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { studioHead, stamp } from "@/lib/studio-rules";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AutoCutCard } from "@/components/cloud-cut-button";
import { ZapierAutopost } from "@/components/zapier-autopost";
import { useServerFn } from "@tanstack/react-start";
import { deleteStudioItems } from "@/lib/studio.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => studioHead("Auto Cut Studio", "Paste a YouTube link and get captioned 9:16 viral shorts, ready for your approval."),
  component: Dashboard,
});

function Dashboard() {
  const qc = useQueryClient();
  const { data: clips = [], error } = useQuery({ queryKey: ["ready-clips"], queryFn: async () => {
    const r = await supabase.from("studio_clips").select("id,title,score,start_seconds,end_seconds,video_path,approved_at,viral_review,source_id,created_at")
      .not("video_path", "is", null).order("created_at", { ascending: false }).limit(60);
    if (r.error) throw r.error;
    const paths = r.data.map((c) => c.video_path!).filter(Boolean);
    const signed = paths.length ? await supabase.storage.from("videos").createSignedUrls(paths, 3600) : { data: [] };
    const urls = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
    return r.data.map((c) => ({ ...c, url: urls.get(c.video_path!) ?? "" }));
  } });
  // Distinct key: this list selects only summary columns, while the Voiceover page caches full rows under ["studio-sources"].
  const { data: sources = [] } = useQuery({ queryKey: ["studio-sources", "summary"], queryFn: async () => {
    const r = await supabase.from("studio_sources").select("id,title,thumbnail_url,duration,author").order("created_at", { ascending: false });
    if (r.error) throw r.error;
    return r.data;
  } });

  const del = useServerFn(deleteStudioItems);
  async function refresh() {
    await Promise.all(["studio-sources", "ready-clips", "studio-clip-count"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  }
  async function removeSource(id: string) {
    if (!window.confirm("Delete this video, all its clips and their saved files?")) return;
    try { const r = await del({ data: { sourceId: id } }); toast.success(`Deleted video and ${r.clips} clips`); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't delete this video"); }
    await refresh();
  }
  async function removeClip(e: MouseEvent, id: string) {
    e.preventDefault(); e.stopPropagation();
    if (!window.confirm("Delete this clip and its saved file?")) return;
    try { await del({ data: { clipIds: [id] } }); toast.success("Clip deleted"); } catch (err) { toast.error(err instanceof Error ? err.message : "Couldn't delete this clip"); }
    await refresh();
  }

  return <div className="max-w-5xl">
    <header className="flex flex-wrap justify-between items-start gap-4">
      <div><p className="studio-eyebrow">AUTO CUT STUDIO</p><h1 className="font-display text-4xl font-bold mt-2">Long videos. <span className="text-primary">Viral shorts.</span></h1></div>
      <Link to="/settings"><Button variant="ghost" size="sm"><KeyRound className="h-4 w-4" />Settings</Button></Link>
    </header>

    <div className="mt-8"><AutoCutCard /></div>
    <ZapierAutopost />

    <div className="flex justify-between items-end mt-12">
      <h2 className="font-display text-2xl font-bold">Ready clips</h2>
      <span className="text-xs text-muted-foreground">{clips.length} {clips.length === 1 ? "clip" : "clips"}</span>
    </div>
    {error && <p className="text-destructive mt-4">Couldn't load your clips. Please refresh.</p>}
    {!clips.length && !error && <div className="mt-4 py-16 text-center rounded-xl border border-dashed border-border">
      <Clapperboard className="h-10 w-10 text-muted-foreground mx-auto" />
      <h3 className="font-display text-xl mt-4">Your shorts will appear here</h3>
      <p className="text-sm text-muted-foreground mt-2">Paste a YouTube link above to start.</p>
    </div>}
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
      {clips.map((c) => {
        const verdict = (c.viral_review as { verdict?: string } | null)?.verdict;
        return <Link key={c.id} to="/clips/$id" params={{ id: c.id }} className="group relative rounded-lg border border-border bg-card overflow-hidden hover:border-primary/60 transition-colors">
          <Button variant="secondary" size="icon" aria-label="Delete clip" title="Delete clip" onClick={(e) => removeClip(e, c.id)} className="absolute top-2 right-2 z-10 h-8 w-8 opacity-90"><Trash2 className="h-4 w-4" /></Button>
          <div className="aspect-[9/16] bg-secondary">
            {c.url ? <video src={`${c.url}#t=0.5`} preload="metadata" muted playsInline className="h-full w-full object-cover" /> : <Film className="h-8 w-8 m-auto mt-20 text-muted-foreground" />}
          </div>
          <div className="p-3 space-y-2">
            <p className="text-sm font-medium line-clamp-2 group-hover:text-primary">{c.title}</p>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>{stamp(c.start_seconds)}–{stamp(c.end_seconds)}</span>
              {c.approved_at ? <Badge className="gap-1 text-[10px] px-1.5 py-0"><CheckCircle2 className="h-3 w-3" />Approved</Badge>
                : verdict ? <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{verdict}</Badge>
                : <Badge variant="outline" className="text-[10px] px-1.5 py-0">Reviewing</Badge>}
            </div>
          </div>
        </Link>;
      })}
    </div>

    {!!sources.length && <>
      <h2 className="font-display text-lg font-bold mt-12">Source videos</h2>
      <ul className="mt-3 divide-y divide-border border-y border-border">
        {sources.map((s) => <li key={s.id} className="flex items-center gap-4 py-3">
          <img src={s.thumbnail_url || ""} alt="" className="w-24 aspect-video object-cover rounded bg-secondary shrink-0" />
          <div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{s.title}</p><p className="text-xs text-muted-foreground">{s.author}{s.duration ? ` · ${stamp(s.duration)}` : ""}</p></div>
          <Button variant="ghost" size="icon" aria-label="Delete video" title="Delete video and its clips" onClick={() => removeSource(s.id)}><Trash2 className="h-4 w-4" /></Button>
        </li>)}
      </ul>
    </>}
  </div>;
}
