import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery,useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, ShieldCheck, Trash2, Save, RefreshCw } from "lucide-react";
import { studioHead,providers,type Provider } from "@/lib/studio-rules";
import { getStudioSettings,saveProvider,removeCredential,listModels } from "@/lib/studio.functions";
import { Button } from "@/components/ui/button";
import { YouTubeConnection } from "@/components/youtube-connection";
import { Link } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
export const Route=createFileRoute("/_authenticated/settings")({head:()=>studioHead("Settings","Personal AI keys, custom endpoints and YouTube channel connections."),component:Settings});
const defaults:Record<Provider,string>={openai:"gpt-4.1-mini",gemini:"gemini-2.5-flash",openrouter:"openai/gpt-4.1-mini",anthropic:"claude-sonnet-4-5",custom:""};
const labels:Record<Provider,string>={openai:"OpenAI",gemini:"Gemini",openrouter:"OpenRouter",anthropic:"Anthropic",custom:"Custom endpoint"};
function Settings(){
  const get=useServerFn(getStudioSettings),save=useServerFn(saveProvider),remove=useServerFn(removeCredential),scan=useServerFn(listModels),qc=useQueryClient();
  const {data=[]}=useQuery({queryKey:["studio-settings"],queryFn:()=>get()});
  const ai=data.find(d=>d.kind==="ai");
  const [provider,setProvider]=useState<Provider>("openai"),[model,setModel]=useState(defaults.openai),[key,setKey]=useState(""),[baseUrl,setBaseUrl]=useState(""),[busy,setBusy]=useState(false),[scanning,setScanning]=useState(false),[models,setModels]=useState<string[]>([]);
  async function findModels(){
    setScanning(true);
    try{
      const r=await scan({data:{provider,key,baseUrl:provider==="custom"?baseUrl:null}});
      setModels(r.models);
      if(r.models.length&&!r.models.includes(model))setModel(r.models[0]!);
      toast.success(`${r.models.length} models found`);
    }catch(e){setModels([]);toast.error(e instanceof Error?e.message:"Couldn't list models");}
    finally{setScanning(false);}
  }
  return <div className="max-w-3xl"><p className="studio-eyebrow">YOUR WORKSPACE</p><h1 className="font-display text-4xl font-bold mt-2">Settings</h1><section className="mt-10 border-t border-border pt-7"><div className="flex gap-3 items-center"><KeyRound className="h-5 w-5 text-primary"/><h2 className="text-xl font-display font-bold">Your AI provider</h2></div><p className="text-muted-foreground mt-3 text-sm">Analysis uses your provider account. No Lovable AI credits; your provider may charge for tokens. Keys are encrypted and stored in your cloud workspace.</p>{ai&&<div className="mt-5 flex items-center justify-between border-l-2 border-primary pl-4"><div><span className="capitalize font-medium">{labels[ai.provider as Provider]||ai.provider}</span><p className="text-sm text-muted-foreground">{ai.model}{ai.base_url?` · ${ai.base_url}`:""} · Key saved</p></div><Button aria-label="Remove AI key" title="Remove AI key" size="icon" variant="ghost" onClick={async()=>{await remove({data:{kind:"ai"}});qc.invalidateQueries({queryKey:["studio-settings"]});toast.success("Key removed");}}><Trash2 className="h-4 w-4"/></Button></div>}<form className="mt-6 space-y-5" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await save({data:{provider,model,key,baseUrl:provider==="custom"?baseUrl:null}});setKey("");qc.invalidateQueries({queryKey:["studio-settings"]});toast.success("Key saved securely");}catch(e){toast.error(e instanceof Error?e.message:"Couldn't save key");}finally{setBusy(false);}}}><div className="grid sm:grid-cols-2 gap-4"><label className="text-sm">Provider<select aria-label="AI provider" className="studio-select mt-2" value={provider} onChange={e=>{const p=e.target.value as Provider;setProvider(p);setModel(defaults[p]);setModels([]);}}>{providers.map(p=><option key={p} value={p}>{labels[p]}</option>)}</select></label><label className="text-sm">Model{models.length?<select aria-label="Provider model" className="studio-select mt-2" value={model} onChange={e=>setModel(e.target.value)}>{models.map(m=><option key={m} value={m}>{m}</option>)}</select>:<Input className="mt-2" value={model} onChange={e=>setModel(e.target.value)} aria-label="Provider model" required/>}</label></div>{provider==="custom"&&<label className="text-sm block">Base URL<Input className="mt-2" type="url" placeholder="https://api.example.com/v1" value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} required aria-label="Custom endpoint base URL"/></label>}<label className="text-sm block">API key<Input className="mt-2" type="password" autoComplete="off" placeholder="Paste your provider API key" value={key} onChange={e=>setKey(e.target.value)} required aria-label="Provider API key"/></label><div className="flex flex-wrap gap-4 items-center"><Button type="button" variant="outline" disabled={scanning||key.length<10||(provider==="custom"&&!baseUrl)} onClick={findModels}><RefreshCw className={`h-4 w-4 ${scanning?"animate-spin":""}`}/>{scanning?"Scanning…":"Find models"}</Button><Button disabled={busy}><Save className="h-4 w-4"/>{busy?"Saving…":ai?"Replace key":"Save key"}</Button><span className="flex gap-2 items-center text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4"/>Encrypted · Never returned to the browser</span></div></form></section><YouTubeConnection/><Link to="/instagram" className="inline-block mt-6 text-sm text-muted-foreground underline">Manage Instagram and Facebook accounts</Link></div>;
}
