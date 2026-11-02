import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { providers, youtubeId, cueSchema, segmentSchema, endpointSchema, providerBaseUrl, transcriptEnd } from "./studio-rules";
import { canApproveClip, viralReviewSchema } from "./clip-review-rules";

export const importYouTube = createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(d=>z.object({url:z.string().max(2000)}).parse(d)).handler(async({data,context})=>{
  const id = youtubeId(data.url);
  const { fetchYouTube } = await import("./youtube.server");
  const video = await fetchYouTube(id);
  const { data: source,error } = await context.supabase.from("studio_sources").insert({...video,transcript:video.transcript.map(c=>({...c})),url:`https://www.youtube.com/watch?v=${id}`,youtube_id:id,user_id:context.userId}).select("id,transcript_status").single();
  if(error) throw new Error(error.message);
  return source;
});
export const saveTranscript = createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(d=>z.object({sourceId:z.string().uuid(),cues:z.array(cueSchema).min(1).max(75000)}).parse(d)).handler(async({data,context})=>{
  const { error } = await context.supabase.from("studio_sources").update({transcript:data.cues.map(c=>({...c})),transcript_status:"imported"}).eq("id",data.sourceId);
  if(error) throw new Error(error.message);
  return {saved:true};
});
export const getStudioSettings = createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).handler(async({context})=>{
  const {supabaseAdmin} = await import("@/integrations/supabase/client.server");
  const {data,error} = await supabaseAdmin.from("studio_credentials").select("kind,provider,model,base_url,account_id,account_name,updated_at").eq("user_id",context.userId);
  if(error) throw new Error("Couldn't read settings.");
  return data || [];
});
export const saveProvider = createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(d=>z.object({provider:z.enum(providers),model:z.string().min(1).max(150).regex(/^[\w./:-]+$/),key:z.string().min(10).max(3000),baseUrl:z.string().max(500).nullable().optional()}).parse(d)).handler(async({data,context})=>{
  const secret=process.env["STUDIO_ENCRYPTION_KEY"];
  if(!secret) throw new Error("Secure key storage is not configured.");
  const baseUrl=data.provider==="custom"?providerBaseUrl("custom",data.baseUrl):null;
  const {encrypt} = await import("./studio-crypto.server");
  const {supabaseAdmin} = await import("@/integrations/supabase/client.server");
  const {error} = await supabaseAdmin.from("studio_credentials").upsert({user_id:context.userId,kind:"ai",provider:data.provider,model:data.model,base_url:baseUrl,encrypted_key:await encrypt(data.key.trim(),secret),updated_at:new Date().toISOString()});
  if(error) throw new Error("Couldn't save the key.");
  return {saved:true};
});
export const listModels = createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(d=>z.object({provider:z.enum(providers),key:z.string().min(10).max(3000),baseUrl:z.string().max(500).nullable().optional()}).parse(d)).handler(async({data})=>{
  const baseUrl=data.provider==="custom"?endpointSchema.parse((data.baseUrl || "").trim().replace(/\/+$/,"")):null;
  const {fetchModels}=await import("./studio-ai.server");
  return {models:await fetchModels(data.provider,data.key.trim(),baseUrl)};
});
export const removeCredential = createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(d=>z.object({kind:z.enum(["ai","facebook"])}).parse(d)).handler(async({data,context})=>{
  const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
  const {error}=await supabaseAdmin.from("studio_credentials").delete().eq("user_id",context.userId).eq("kind",data.kind);
  if(error) throw new Error("Couldn't disconnect.");
  return {removed:true};
});
export const analyzeSource = createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(d=>z.object({sourceId:z.string().uuid(),duration:z.number().min(20).max(86400).optional(),outline:z.string().max(6000).optional()}).parse(d)).handler(async({data,context})=>{
  const {data:source}=await context.supabase.from("studio_sources").select("*").eq("id",data.sourceId).single();
  if(!source) throw new Error("Video not found.");
  const cues=z.array(cueSchema).parse(source.transcript);
  const duration=source.duration||data.duration;
  if(!cues.length&&!duration)throw new Error("Enter the video duration for structure-only suggestions, or add audio / a transcript.");
  const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
  const {data:credential}=await supabaseAdmin.from("studio_credentials").select("*").eq("user_id",context.userId).eq("kind","ai").maybeSingle();
  const secret=process.env["STUDIO_ENCRYPTION_KEY"];
  if(!secret) throw new Error("Secure key storage is not configured.");
  const {withAi}=await import("./studio-ai-default.server");
  const {analyzeWithKey}=await import("./studio-ai.server");
  const segments=await withAi(credential,secret,c=>analyzeWithKey(c.provider,c.model,c.key,cues,c.baseUrl,{title:source.title,duration:duration||transcriptEnd(cues),outline:data.outline||""}));
  const {error}=await context.supabase.from("studio_clips").insert(segments.map(s=>({user_id:context.userId,source_id:source.id,title:s.title,start_seconds:s.start,end_seconds:s.end,score:s.score,reason:s.reason,caption:cues.filter(c=>c.end>s.start&&c.start<s.end).map(c=>c.text).join(" ").slice(0,2200)||s.title})));
  if(error) throw new Error(error.message);
  return {count:segments.length};
});
export const addManualClip=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(d=>z.object({sourceId:z.string().uuid(),segment:segmentSchema}).parse(d)).handler(async({data,context})=>{
  const {data:s}=await context.supabase.from("studio_sources").select("duration").eq("id",data.sourceId).single();
  if(!s) throw new Error("Video not found.");
  if(s.duration && data.segment.end>s.duration) throw new Error("Clip exceeds the source duration.");
  const {data:source}=await context.supabase.from("studio_sources").select("transcript").eq("id",data.sourceId).single();
  const caption=z.array(cueSchema).parse(source?.transcript||[]).filter(c=>c.end>data.segment.start&&c.start<data.segment.end).map(c=>c.text).join(" ").slice(0,2200)||data.segment.title;
  const {data:clip,error}=await context.supabase.from("studio_clips").insert({user_id:context.userId,source_id:data.sourceId,title:data.segment.title,start_seconds:data.segment.start,end_seconds:data.segment.end,score:0,reason:"Manually selected",caption}).select("id").single();
  if(error) throw new Error(error.message);
  return clip;
});
export const attachStudioVideo=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(d=>z.object({clipId:z.string().uuid(),path:z.string().max(300),caption:z.string().max(2200)}).parse(d)).handler(async({data,context})=>{
  const {data:c}=await context.supabase.from("studio_clips").select("id").eq("id",data.clipId).single();
  if(!c) throw new Error("Clip not found.");
  const prefix=`${context.userId}/clips/${c.id}/`;
  if(!data.path.startsWith(prefix)||!/^[\w-]+\.mp4$/.test(data.path.slice(prefix.length))) throw new Error("Invalid upload path.");
  const {data:files,error}=await context.supabase.storage.from("videos").list(prefix.slice(0,-1),{search:data.path.slice(prefix.length)});
  const file=files?.find(f=>f.name===data.path.slice(prefix.length));
  if(error||!file||file.metadata?.mimetype!=="video/mp4"||!file.metadata?.size||file.metadata.size>50*1024*1024) throw new Error("Upload a valid MP4 under 50 MB.");
  const {error:updateError}=await context.supabase.from("studio_clips").update({video_path:data.path,caption:data.caption}).eq("id",c.id);
  if(updateError) throw new Error(updateError.message);
  return {saved:true};
});
export const connectFacebook=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(d=>z.object({pageId:z.string().trim().regex(/^(\d+|me)$/i),token:z.string().trim().min(20).max(3000)}).parse(d)).handler(async({data,context})=>{
  const secret=process.env["STUDIO_ENCRYPTION_KEY"];
  if(!secret) throw new Error("Secure key storage is not configured.");
  const {verifyFacebook}=await import("./studio-meta.server");
  const page=await verifyFacebook(data.pageId,data.token);
  const {encrypt}=await import("./studio-crypto.server");
  const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
  const {error}=await supabaseAdmin.from("studio_credentials").upsert({user_id:context.userId,kind:"facebook",provider:"facebook",account_id:page.id,account_name:page.name,encrypted_key:await encrypt(data.token.trim(),secret),updated_at:new Date().toISOString()});
  if(error) throw new Error("Couldn't save Facebook connection.");
  return {name:page.name};
});
export const publishStudioClip=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(d=>z.object({clipId:z.string().uuid(),platform:z.enum(["instagram","facebook"]),caption:z.string().max(2200),scheduledAt:z.string().datetime().nullable()}).parse(d)).handler(async({data,context})=>{
  const {data:c}=await context.supabase.from("studio_clips").select("video_path,approved_at,caption,viral_review").eq("id",data.clipId).single();
  if(!c?.video_path) throw new Error("Export and save the clip first.");
  if(!c.approved_at||!canApproveClip(c)||c.caption!==data.caption)throw new Error("Save your changes, review with AI, and approve this clip before posting.");
  if(data.scheduledAt && Date.parse(data.scheduledAt)<=Date.now()) throw new Error("Choose a future posting time.");
  const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
  const {data:p,error}=await supabaseAdmin.from("studio_posts").insert({user_id:context.userId,clip_id:data.clipId,platform:data.platform,caption:data.caption,scheduled_at:data.scheduledAt || new Date().toISOString()}).select("*").single();
  if(error) throw new Error("Couldn't queue the post.");
  if(!data.scheduledAt){ const {advanceStudioPost}=await import("./studio-meta.server"); await advanceStudioPost(supabaseAdmin,p,process.env["STUDIO_ENCRYPTION_KEY"] || ""); }
  return {id:p.id};
});
export const refreshStudioPosts=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).handler(async({context})=>{
  const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
  const {advanceStudioPost}=await import("./studio-meta.server");
  const {data:posts}=await context.supabase.from("studio_posts").select("*").or(`and(status.eq.scheduled,scheduled_at.lte.${new Date().toISOString()}),status.eq.processing`).limit(20);
  for(const post of posts || []) await advanceStudioPost(supabaseAdmin,post,process.env["STUDIO_ENCRYPTION_KEY"] || "");
  return {refreshed:true};
});
export const refreshAnalytics=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).handler(async({context})=>{
  const {data:posts}=await context.supabase.from("studio_posts").select("*").eq("status","published").order("created_at",{ascending:false}).limit(30);
  const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
  const {refreshStudioMetrics}=await import("./studio-meta.server");
  for(const post of posts || []) await refreshStudioMetrics(supabaseAdmin,post,process.env["STUDIO_ENCRYPTION_KEY"] || "");
  return {refreshed:posts?.length || 0};
});
export const saveClipPlan=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(d=>z.object({clipId:z.string().uuid(),caption:z.string().max(2200),voiceover:z.string().max(4000)}).parse(d)).handler(async({data,context})=>{
  const {error}=await context.supabase.from("studio_clips").update({caption:data.caption,voiceover:data.voiceover,approved_at:null}).eq("id",data.clipId);
  if(error) throw new Error("Couldn't save the clip plan.");
  return {saved:true};
});
export const approveClip=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(d=>z.object({clipId:z.string().uuid()}).parse(d)).handler(async({data,context})=>{
  const {data:c}=await context.supabase.from("studio_clips").select("video_path,viral_review").eq("id",data.clipId).single();
  if(!c?.video_path) throw new Error("Export and save the clip before approving.");
  if(!canApproveClip(c))throw new Error("Run the AI viral review before approving this clip.");
  const {error}=await context.supabase.from("studio_clips").update({approved_at:new Date().toISOString()}).eq("id",data.clipId);
  if(error) throw new Error("Couldn't approve the clip.");
  return {approved:true};
});
export const generateClipText=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(d=>z.object({clipId:z.string().uuid()}).parse(d)).handler(async({data,context})=>{
  const {data:clip}=await context.supabase.from("studio_clips").select("*,studio_sources(transcript)").eq("id",data.clipId).single();
  if(!clip) throw new Error("Clip not found.");
  const cues=z.array(cueSchema).parse(clip.studio_sources?.transcript || []).filter(c=>c.end>clip.start_seconds&&c.start<clip.end_seconds);
  let caption=clip.title,voiceover=cues.map(c=>c.text).join(" ").slice(0,1200);
  caption=cues.map(c=>c.text).join(" ").slice(0,2200)||clip.title;
  if(!voiceover) voiceover=clip.title;
  const {error}=await context.supabase.from("studio_clips").update({caption,voiceover,approved_at:null}).eq("id",data.clipId);
  if(error) throw new Error("Couldn't save the generated text.");
  return {caption,voiceover};
});

export const reviewClip=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(d=>z.object({clipId:z.string().uuid()}).parse(d)).handler(async({data,context})=>{
  const {data:clip}=await context.supabase.from("studio_clips").select("*,studio_sources(transcript)").eq("id",data.clipId).single();
  if(!clip)throw new Error("Clip not found.");
  const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
  const {data:credential}=await supabaseAdmin.from("studio_credentials").select("*").eq("user_id",context.userId).eq("kind","ai").maybeSingle();
  const secret=process.env["STUDIO_ENCRYPTION_KEY"];if(!secret)throw new Error("Secure key storage is not configured.");
  const {withAi}=await import("./studio-ai-default.server");const {reviewWithKey}=await import("./studio-ai.server");
  const cues=z.array(cueSchema).parse(clip.studio_sources?.transcript||[]).filter(c=>c.end>clip.start_seconds&&c.start<clip.end_seconds);
  const review=viralReviewSchema.parse(await withAi(credential,secret,c=>reviewWithKey(c.provider,c.model,c.key,c.baseUrl,clip.title,cues,clip.caption,clip.voiceover||"",clip.end_seconds-clip.start_seconds)));
  // Compare against the content reviewed; a simultaneous edit must not get a stale approval.
  let query=context.supabase.from("studio_clips").update({viral_review:review,approved_at:null}).eq("id",clip.id).eq("caption",clip.caption).eq("start_seconds",clip.start_seconds).eq("end_seconds",clip.end_seconds);
  query=clip.voiceover===null?query.is("voiceover",null):query.eq("voiceover",clip.voiceover);
  query=clip.video_path===null?query.is("video_path",null):query.eq("video_path",clip.video_path);
  const update=await query.select("id").maybeSingle();
  if(update.error||!update.data)throw new Error("Clip changed during review. Run a fresh review.");
  return review;
});