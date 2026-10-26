import { useServerFn } from "@tanstack/react-start";
import { useQuery,useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Youtube,Unplug } from "lucide-react";
import { toast } from "sonner";
import { getYouTubeConnection,startYouTubeConnect,disconnectYouTube } from "@/lib/youtube-publishing.functions";
import { Button } from "@/components/ui/button";
export function YouTubeConnection(){
  const get=useServerFn(getYouTubeConnection),start=useServerFn(startYouTubeConnect),disconnect=useServerFn(disconnectYouTube),qc=useQueryClient();
  const {data}=useQuery({queryKey:["youtube-connection"],queryFn:()=>get()});const [busy,setBusy]=useState(false);
  async function connect(){
    const popup=window.open("","cutline-youtube","width=600,height=720");if(!popup){toast.error("Allow popups to connect YouTube.");return;}setBusy(true);
    try{
      const result=await start();
      await new Promise<void>((resolve,reject)=>{
        const cleanup=()=>{window.removeEventListener("message",message);clearInterval(timer);clearTimeout(timeout);};
        const message=(e:MessageEvent)=>{if(e.origin!==window.location.origin||e.source!==popup||e.data?.type!=="cutline-youtube-connected")return;cleanup();e.data.success?resolve():reject(new Error("YouTube connection failed. Grant channel and upload access, then try again."));};
        window.addEventListener("message",message);
        const timer=window.setInterval(()=>{if(popup.closed){cleanup();reject(new Error("Connection window closed."));}},500);
        const timeout=window.setTimeout(()=>{cleanup();reject(new Error("Connection expired. Try again."));},600000);
        popup.location.href=result.url;
      });
      await qc.invalidateQueries({queryKey:["youtube-connection"]});toast.success("YouTube connected successfully");
    }catch(e){popup.close();toast.error(e instanceof Error?e.message:"Couldn't connect YouTube");}finally{setBusy(false);}
  }
  return <section className="mt-10 border-t border-border pt-7"><div className="flex gap-3 items-center"><Youtube className="h-5 w-5 text-primary"/><h2 className="font-display text-xl font-bold">YouTube channel</h2></div>{data?.channel&&<p className="mt-4 text-primary">Connected: {data.channel.channel_name}</p>}<div className="flex gap-3 mt-5"><Button disabled={busy||!data?.configured} onClick={connect}><Youtube className="h-4 w-4"/>{busy?"Connecting…":data?.channel?"Reconnect YouTube":"Connect YouTube"}</Button>{data?.channel&&<Button variant="outline" disabled={busy} onClick={async()=>{setBusy(true);try{await disconnect();await qc.invalidateQueries({queryKey:["youtube-connection"]});toast.success("YouTube disconnected");}catch(e){toast.error(e instanceof Error?e.message:"Couldn't disconnect");}finally{setBusy(false);}}}><Unplug className="h-4 w-4"/>Disconnect</Button>}</div>{data&&!data.configured&&<p className="text-sm text-muted-foreground mt-3">Google OAuth setup is pending.</p>}</section>;
}