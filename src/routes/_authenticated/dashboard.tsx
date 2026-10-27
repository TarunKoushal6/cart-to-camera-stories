import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery,useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Youtube, ArrowRight, Film, Scissors, Loader2, KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { importYouTube } from "@/lib/studio.functions";
import { studioHead } from "@/lib/studio-rules";
import { StudioSource } from "@/components/studio-source";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CloudCutButton } from "@/components/cloud-cut-button";
export const Route=createFileRoute("/_authenticated/dashboard")({head:()=>studioHead("Studio","Repurpose YouTube videos into captioned vertical shorts."),component:Dashboard});
function Dashboard(){
 const qc=useQueryClient(),add=useServerFn(importYouTube);
 const [url,setUrl]=useState(""),[busy,setBusy]=useState(false);
 const {data:sources=[],error}=useQuery({queryKey:["studio-sources"],queryFn:async()=>{const r=await supabase.from("studio_sources").select("*").order("created_at",{ascending:false});if(r.error)throw r.error;return r.data;}});
 const {data:clips=[]}=useQuery({queryKey:["studio-clip-count"],queryFn:async()=>{const r=await supabase.from("studio_clips").select("id,video_path");if(r.error)throw r.error;return r.data;}});
 return <div><header className="flex flex-wrap justify-between items-start gap-4"><div><p className="studio-eyebrow">REPURPOSING STUDIO</p><h1 className="font-display text-4xl font-bold mt-2">Long videos. <span className="text-primary">Short stories.</span></h1></div><Link to="/settings"><Button variant="outline" size="sm"><KeyRound className="h-4 w-4"/>Your AI key</Button></Link></header>
 <section className="mt-9 py-7 border-y border-border"><h2 className="font-medium flex gap-2 items-center"><Youtube className="h-5 w-5 text-accent"/>Import a YouTube video</h2><form className="flex flex-col sm:flex-row gap-3 mt-4" onSubmit={async e=>{e.preventDefault();setBusy(true);try{const r=await add({data:{url}});setUrl("");qc.invalidateQueries({queryKey:["studio-sources"]});toast.success(r.transcript_status==="available"?"Video and captions imported":"Video imported. Automatic captions unavailable; import SRT or VTT captions.");}catch(e){toast.error(e instanceof Error?e.message:"Couldn't import video");}finally{setBusy(false);}}}><Input aria-label="YouTube URL" placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={e=>setUrl(e.target.value)} type="url" required className="h-12 bg-card"/><Button disabled={busy} className="h-12 shrink-0">{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<ArrowRight className="h-4 w-4"/>}{busy?"Importing…":"Import video"}</Button></form><div className="mt-3"><CloudCutButton url={url}/></div><p className="text-xs text-muted-foreground mt-3">Free metadata & available captions · Only use videos you own or have permission to repurpose</p></section>
 <div className="grid grid-cols-3 gap-4 py-7 border-b border-border">{[{label:"Source videos",value:sources.length,Icon:Film},{label:"Selected moments",value:clips.length,Icon:Scissors},{label:"Exported shorts",value:clips.filter(c=>c.video_path).length,Icon:ArrowRight}].map(s=><div key={s.label}><div className="flex gap-2 items-center text-xs text-muted-foreground"><s.Icon className="h-4 w-4"/>{s.label}</div><p className="font-display text-3xl font-bold mt-2">{s.value.toString().padStart(2,"0")}</p></div>)}</div>
 <div className="flex justify-between items-center mt-8"><h2 className="font-display text-xl font-bold">Your source library</h2><span className="text-xs text-muted-foreground">{sources.length} videos</span></div>{error&&<p className="text-destructive mt-4">Couldn't load your library. Please refresh.</p>}{!sources.length&&!error&&<div className="py-16 text-center border-b border-border"><Film className="h-10 w-10 text-muted-foreground mx-auto"/><h3 className="font-display text-xl mt-4">Your next short starts here</h3><p className="text-sm text-muted-foreground mt-2">No source videos imported yet.</p></div>}{sources.map(s=><StudioSource key={s.id} source={s}/>)}</div>;
}
