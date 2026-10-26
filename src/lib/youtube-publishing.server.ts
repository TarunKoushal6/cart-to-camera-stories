import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { encrypt, decrypt } from "./studio-crypto.server";
import { youtubeCounts } from "./youtube-publishing-rules";
type Admin=SupabaseClient<Database>;
type Tokens={access_token:string;refresh_token:string;expires_at:number};
const API="https://www.googleapis.com/youtube/v3";
export const YOUTUBE_SCOPES=["https://www.googleapis.com/auth/youtube.upload","https://www.googleapis.com/auth/youtube.readonly"];
export function googleConfig(){
  const clientId=process.env["YOUTUBE_CLIENT_ID"],clientSecret=process.env["YOUTUBE_CLIENT_SECRET"],secret=process.env["STUDIO_ENCRYPTION_KEY"];
  if(!clientId||!clientSecret||!secret)throw new Error("YouTube setup is incomplete. Add Google OAuth credentials before connecting.");
  return {clientId,clientSecret,secret};
}
export async function googleJson<T>(res:Response):Promise<T>{
  if(!res.ok){
    const body=await res.json().catch(()=>null) as {error?:{errors?:{reason?:string}[]}}|null;
    const reason=body?.error?.errors?.[0]?.reason;
    const safeReasons=["quotaExceeded","uploadLimitExceeded","forbidden","insufficientPermissions","videoNotFound","invalidPublishAt","invalidTitle","invalidDescription","invalidTags"];
    throw new Error(`YouTube request failed (${res.status})${reason&&safeReasons.includes(reason)?`: ${reason}`:""}. Check Google permissions, quota, and video requirements.`);
  }
  return res.json() as Promise<T>;
}
export async function channel(token:string){
  const body=await googleJson<{items?:{id:string;snippet:{title:string}}[]}>(await fetch(`${API}/channels?part=snippet&mine=true`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)}));
  const c=body.items?.[0];if(!c)throw new Error("This Google account has no YouTube channel.");return c;
}
export async function accessToken(admin:Admin,userId:string){
  const config=googleConfig();
  const {data,error}=await admin.from("youtube_connections").select("encrypted_tokens").eq("user_id",userId).maybeSingle();
  if(error||!data)throw new Error("Connect your YouTube channel in Settings first.");
  const tokens=JSON.parse(await decrypt(data.encrypted_tokens,config.secret)) as Tokens;
  if(tokens.expires_at>Date.now()+60000)return tokens.access_token;
  const res=await fetch("https://oauth2.googleapis.com/token",{method:"POST",body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,grant_type:"refresh_token",refresh_token:tokens.refresh_token}),signal:AbortSignal.timeout(20000)});
  if(!res.ok)throw new Error("Your YouTube access needs renewal. Reconnect YouTube in Settings.");
  const t=await res.json() as {access_token:string;expires_in:number};
  tokens.access_token=t.access_token;tokens.expires_at=Date.now()+t.expires_in*1000;
  const up=await admin.from("youtube_connections").update({encrypted_tokens:await encrypt(JSON.stringify(tokens),config.secret),updated_at:new Date().toISOString()}).eq("user_id",userId);
  if(up.error)throw new Error("Couldn't renew YouTube access.");return tokens.access_token;
}
export async function pollYouTubePost(admin:Admin,post:Database["public"]["Tables"]["youtube_posts"]["Row"]){
  if(!post.media_id)return;
  try{
    const token=await accessToken(admin,post.user_id);
    const r=await googleJson<{items?:{status:{uploadStatus:string;privacyStatus:string;publishAt?:string};processingDetails?:{processingStatus:string}}[]}>(await fetch(`${API}/videos?part=status,processingDetails&id=${encodeURIComponent(post.media_id)}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)}));
    const v=r.items?.[0];if(!v)throw new Error("YouTube video is unavailable or was deleted.");
    if(["failed","rejected","deleted"].includes(v.status.uploadStatus)||v.processingDetails?.processingStatus==="failed")throw new Error("YouTube could not process this video.");
    const ready=v.status.uploadStatus==="processed"||v.processingDetails?.processingStatus==="succeeded";
    if(!ready)return;
    const status=post.scheduled_at&&v.status.privacyStatus!=="public"?"scheduled":"published";
    await admin.from("youtube_posts").update({status,error:null}).eq("id",post.id);
  }catch(e){await admin.from("youtube_posts").update({error:e instanceof Error?e.message:"YouTube status unavailable"}).eq("id",post.id);}
}
export async function refreshYouTubeMetrics(admin:Admin,post:Database["public"]["Tables"]["youtube_posts"]["Row"]){
  if(!post.media_id)return;
  try{
    const token=await accessToken(admin,post.user_id);
    const r=await googleJson<{items?:{statistics:Record<string,string>}[]}>(await fetch(`${API}/videos?part=statistics&id=${encodeURIComponent(post.media_id)}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)}));
    const v=r.items?.[0];if(!v)throw new Error("YouTube video is unavailable.");
    await admin.from("youtube_posts").update({...youtubeCounts(v.statistics),metrics_at:new Date().toISOString(),metrics_error:null}).eq("id",post.id);
  }catch(e){await admin.from("youtube_posts").update({metrics_error:e instanceof Error?e.message:"YouTube metrics unavailable"}).eq("id",post.id);}
}
export async function stateHash(state:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(state)))).map(b=>b.toString(16).padStart(2,"0")).join("");}