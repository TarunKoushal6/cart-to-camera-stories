import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery,useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Youtube, ArrowRight, Mic, Loader2, CheckCircle2, Scissors } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { importYouTube } from "@/lib/studio.functions";
import { studioHead, stamp } from "@/lib/studio-rules";
import { StudioSource } from "@/components/studio-source";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export const Route=createFileRoute("/_authenticated/voiceover")({head:()=>studioHead("Voiceover studio","Cut YouTube moments, add captions and voiceover, approve and post everywhere."),component:VoiceoverStudio});
function VoiceoverStudio(){
 const qc=useQueryClient(),add=useServerFn(importYouTube);
 const [url,setUrl]=useState(""),[busy,setBusy]=useState(false);
 const {data:sources=[],error}=useQuery({queryKey:["studio-sources"],queryFn:async()=>{const r=await supabase.from("studio_sources").select("*").order("created_at",{ascending:false});if(r.error)throw r.error;return r.data;}});
 const {data:clips=[]}=useQuery({queryKey:["studio-clip-count"],queryFn:async()=>{const r=await supabase.from("studio_clips").select("id,title,start_seconds,end_seconds,video_path,approved_at");if(r.error)throw r.error;return r.data;}});
 const ready=clips.filter(c=>c.video_path);
 return <div><header><p className="studio-eyebrow">VOICEOVER STUDIO</p><h1 className="font-display text-4xl font-bold mt-2">Cut. Caption. <span className="text-primary">Speak.</span></h1><p className="text-muted-foreground mt-3 max-w-2xl text-sm">Import a YouTube video, let AI pick the moments or cut them yourself, add burned-in captions and a voiceover, then approve and post to Instagram, Facebook and YouTube Shorts. Nothing is posted without your approval.</p></header>
 <section className="mt-9 py-7 border-y border-border"><h2 className="font-medium flex gap-2 items-center"><Youtube className="h-5 w-5 text-accent"/>Add a YouTube video</h2><form className="flex flex-col sm:flex-row gap-3 mt-4" onSubmit={async e=>{e.preventDefault();setBusy(true);try{const r=await add({data:{url}});setUrl("");qc.invalidateQueries({queryKey:["studio-sources"]});toast.success(r.transcript_status==="available"?"Video and captions imported":"Video imported. Automatic captions unavailable; import SRT or VTT captions.");}catch(e){toast.error(e instanceof Error?e.message:"Couldn't import video");}finally{setBusy(false);}}}><Input aria-label="YouTube URL" placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={e=>setUrl(e.target.value)} type="url" required className="h-12 bg-card"/><Button disabled={busy} className="h-12 shrink-0">{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<ArrowRight className="h-4 w-4"/>}{busy?"Importing…":"Import video"}</Button></form></section>
 <section className="py-7 border-b border-border"><h2 className="font-medium flex gap-2 items-center"><Mic className="h-5 w-5 text-primary"/>Clips ready for posting</h2>{!ready.length?<p className="text-sm text-muted-foreground mt-3">No exported clips yet. Pick a moment below, add captions and a voiceover in the clip editor, then export.</p>:<div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 mt-4">{ready.map(c=><Link to="/clips/$id" params={{id:c.id}} key={c.id} className="border border-border rounded-md p-4 hover:border-primary/60 transition-colors bg-card block"><div className="flex justify-between text-xs text-muted-foreground"><span>{stamp(c.start_seconds)} — {stamp(c.end_seconds)}</span>{c.approved_at?<span className="text-primary flex gap-1 items-center"><CheckCircle2 className="h-3 w-3"/>Approved</span>:<span>Awaiting approval</span>}</div><h3 className="font-medium mt-2">{c.title}</h3></Link>)}</div>}</section>
 <div className="flex justify-between items-center mt-8"><h2 className="font-display text-xl font-bold flex gap-2 items-center"><Scissors className="h-5 w-5 text-primary"/>Sources & moments</h2><span className="text-xs text-muted-foreground">{sources.length} videos</span></div>{error&&<p className="text-destructive mt-4">Couldn't load your library. Please refresh.</p>}{!sources.length&&!error&&<p className="text-sm text-muted-foreground py-10">No source videos imported yet.</p>}{sources.map(s=><StudioSource key={s.id} source={s}/>)}</div>;
}
