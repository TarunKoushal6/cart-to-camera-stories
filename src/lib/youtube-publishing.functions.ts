import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { youtubePublishSchema,youtubeMetadata } from "./youtube-publishing-rules";
export const getYouTubeConnection=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).handler(async({context})=>{
  const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
  const {data}=await supabaseAdmin.from("youtube_connections").select("channel_id,channel_name").eq("user_id",context.userId).maybeSingle();
  return {configured:Boolean(process.env["YOUTUBE_CLIENT_ID"]&&process.env["YOUTUBE_CLIENT_SECRET"]),channel:data};
});
export const startYouTubeConnect=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).handler(async({context})=>{
  const {googleConfig,stateHash,YOUTUBE_SCOPES}=await import("./youtube-publishing.server");const config=googleConfig();
  const request=getRequest(),url=new URL(request.url);
  const host=url.hostname==="localhost"?request.headers.get("x-forwarded-host"):null;
  const origin=host?`https://${host}`:url.origin;
  const redirectUri=new URL("/api/public/oauth/youtube/callback",origin).toString();
  const state=crypto.randomUUID()+crypto.randomUUID();
  const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
  const {error}=await supabaseAdmin.from("youtube_oauth_states").insert({state_hash:await stateHash(state),user_id:context.userId,redirect_uri:redirectUri,expires_at:new Date(Date.now()+10*60*1000).toISOString()});
  if(error)throw new Error("Couldn't start YouTube connection.");
  const auth=new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.search=new URLSearchParams({client_id:config.clientId,redirect_uri:redirectUri,response_type:"code",scope:YOUTUBE_SCOPES.join(" "),state,access_type:"offline",prompt:"consent"}).toString();
  return {url:auth.toString()};
});
export const disconnectYouTube=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).handler(async({context})=>{
  const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
  const {data}=await supabaseAdmin.from("youtube_connections").select("encrypted_tokens").eq("user_id",context.userId).maybeSingle();
  if(data){
    const {decrypt}=await import("./studio-crypto.server");const secret=process.env["STUDIO_ENCRYPTION_KEY"];if(!secret)throw new Error("Secure storage unavailable.");
    const tokens=JSON.parse(await decrypt(data.encrypted_tokens,secret)) as {refresh_token:string};
    const r=await fetch("https://oauth2.googleapis.com/revoke",{method:"POST",body:new URLSearchParams({token:tokens.refresh_token}),signal:AbortSignal.timeout(20000)});
    if(!r.ok&&r.status!==400)throw new Error("Google couldn't disconnect. Try again.");
  }
  const {error}=await supabaseAdmin.from("youtube_connections").delete().eq("user_id",context.userId);if(error)throw new Error("Couldn't disconnect YouTube.");return {removed:true};
});
export const publishYouTubeClip=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(d=>youtubePublishSchema.parse(d)).handler(async({data,context})=>{
  if(data.scheduledAt&&Date.parse(data.scheduledAt)<=Date.now())throw new Error("Choose a future release time.");
  const {data:clip}=await context.supabase.from("studio_clips").select("video_path").eq("id",data.clipId).single();if(!clip?.video_path)throw new Error("Export and save the clip first.");
  const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
  const {accessToken,googleJson}=await import("./youtube-publishing.server");const token=await accessToken(supabaseAdmin,context.userId);
  const {data:post,error}=await context.supabase.from("youtube_posts").insert({user_id:context.userId,clip_id:data.clipId,title:data.title,description:data.description,tags:data.tags,privacy:data.privacy,scheduled_at:data.scheduledAt}).select("id").single();
  if(error)throw new Error("Couldn't queue YouTube upload.");
  try{
    const {data:signed,error:signError}=await context.supabase.storage.from("videos").createSignedUrl(clip.video_path,3600);if(signError||!signed)throw new Error("Couldn't read the saved clip.");
    const video=await fetch(signed.signedUrl,{signal:AbortSignal.timeout(120000)});
    const size=Number(video.headers.get("content-length"));
    if(!video.ok||!video.body||!size||size>50*1024*1024)throw new Error("Upload a valid saved clip under 50 MB.");
    const session=await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json","X-Upload-Content-Type":"video/mp4","X-Upload-Content-Length":String(size)},body:JSON.stringify(youtubeMetadata(data)),signal:AbortSignal.timeout(20000)});
    if(!session.ok)await googleJson(session);
    const location=session.headers.get("location");if(!location)throw new Error("YouTube did not start an upload.");
    const target=new URL(location);if(target.protocol!=="https:"||target.hostname!=="www.googleapis.com")throw new Error("Invalid YouTube upload destination.");
    // Stream the private saved clip; never buffer a large video in the Worker.
    const result=await googleJson<{id:string}>(await fetch(target,{method:"PUT",headers:{Authorization:`Bearer ${token}`,"Content-Type":"video/mp4","Content-Length":String(size),"Content-Range":`bytes 0-${size-1}/${size}`},body:video.body,signal:AbortSignal.timeout(120000)}));
    if(!result.id)throw new Error("YouTube returned no video ID.");
    const updated=await context.supabase.from("youtube_posts").update({media_id:result.id,error:null}).eq("id",post.id);if(updated.error)throw new Error("Video uploaded but its status could not be saved. Check your YouTube channel before retrying.");
    return {id:post.id};
  }catch(e){const message=e instanceof Error?e.message:"YouTube upload failed";await context.supabase.from("youtube_posts").update({status:"failed",error:message}).eq("id",post.id);throw new Error(message);}
});
export const refreshYouTubePosts=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).handler(async({context})=>{
  const {data}=await context.supabase.from("youtube_posts").select("*").in("status",["processing","scheduled"]).limit(30);
  const {supabaseAdmin}=await import("@/integrations/supabase/client.server");const {pollYouTubePost}=await import("./youtube-publishing.server");
  for(const p of data||[])await pollYouTubePost(supabaseAdmin,p);return {refreshed:true};
});
export const refreshYouTubeAnalytics=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).handler(async({context})=>{
  const {data}=await context.supabase.from("youtube_posts").select("*").eq("status","published").limit(30);
  const {supabaseAdmin}=await import("@/integrations/supabase/client.server");const {refreshYouTubeMetrics}=await import("./youtube-publishing.server");
  for(const p of data||[])await refreshYouTubeMetrics(supabaseAdmin,p);return {refreshed:true};
});