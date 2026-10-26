import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "./studio-crypto.server";
type Post = Database["public"]["Tables"]["studio_posts"]["Row"];
type GraphResult = { id?: string; name?: string; video_id?: string; status_code?: string; status?: { processing_phase?: { status?: string }; publishing_phase?: { status?: string } }; like_count?: number; comments_count?: number; likes?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } }; data?: { name: string; values?: { value: number }[] }[] };
async function graph(base: string, path: string, token: string, params?: Record<string,string>) {
  const url = new URL(`${base}/${path}`);
  const headers = { Authorization: `Bearer ${token}` };
  const r = await fetch(url, params ? { method: "POST", headers, body: new URLSearchParams(params), signal: AbortSignal.timeout(20000) } : { headers, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Meta request failed (${r.status}). Check account permissions, token expiry and media requirements.`);
  return r.json() as Promise<GraphResult>;
}
export async function verifyFacebook(pageId: string, token: string) {
  const page = await graph("https://graph.facebook.com/v23.0", `${pageId}?fields=id,name`, token);
  if (!page.id) throw new Error("Page not found");
  return { id: page.id, name: page.name || page.id };
}
async function account(admin: SupabaseClient<Database>, post: Post, secret: string) {
  if (post.platform === "instagram") {
    const { data } = await admin.from("instagram_accounts").select("ig_user_id,access_token").eq("user_id",post.user_id).maybeSingle();
    if (!data) throw new Error("Connect Instagram first.");
    return { id: data.ig_user_id, token: data.access_token, base: "https://graph.instagram.com/v23.0" };
  }
  const { data } = await admin.from("studio_credentials").select("*").eq("user_id",post.user_id).eq("kind","facebook").maybeSingle();
  if (!data) throw new Error("Connect a Facebook Page first.");
  return { id: data.account_id, token: await decrypt(data.encrypted_key, secret), base: "https://graph.facebook.com/v23.0" };
}
export async function advanceStudioPost(admin: SupabaseClient<Database>, post: Post, secret: string) {
  try {
    const a = await account(admin,post,secret);
    if (post.status === "scheduled") {
      const { data: clip } = await admin.from("studio_clips").select("video_path").eq("id",post.clip_id).eq("user_id",post.user_id).single();
      if (!clip?.video_path) throw new Error("Export the clip first.");
      const { data: signed, error } = await admin.storage.from("videos").createSignedUrl(clip.video_path,86400);
      if (error || !signed) throw new Error("Couldn't prepare the clip.");
      if (post.platform === "instagram") {
        const c = await graph(a.base,`${a.id}/media`,a.token,{ media_type:"REELS",video_url:signed.signedUrl,caption:post.caption });
        if (!c.id) throw new Error("Meta returned no media container.");
        await admin.from("studio_posts").update({status:"processing",container_id:c.id,error:null}).eq("id",post.id);
      } else {
        const c = await graph(a.base,`${a.id}/video_reels`,a.token,{upload_phase:"start"});
        if (!c.video_id || !/^\d+$/.test(c.video_id)) throw new Error("Meta returned no video session.");
        // Known Meta upload host, never use an arbitrary URL from a remote response.
        const up = await fetch(`https://rupload.facebook.com/video-upload/v23.0/${c.video_id}`,{method:"POST",headers:{Authorization:`OAuth ${a.token}`,file_url:signed.signedUrl},signal:AbortSignal.timeout(20000)});
        if (!up.ok) throw new Error(`Facebook upload failed (${up.status}).`);
        await admin.from("studio_posts").update({status:"processing",container_id:c.video_id,error:null}).eq("id",post.id);
      }
      return "processing";
    }
    if (post.status !== "processing" || !post.container_id) return post.status;
    if (post.platform === "instagram") {
      const s = await graph(a.base,`${post.container_id}?fields=status_code`,a.token);
      if (["ERROR","EXPIRED"].includes(s.status_code || "")) throw new Error("Instagram could not process this clip.");
      if (s.status_code !== "FINISHED") return "processing";
      const p = await graph(a.base,`${a.id}/media_publish`,a.token,{creation_id:post.container_id});
      if (!p.id) throw new Error("Instagram returned no published media ID.");
      await admin.from("studio_posts").update({status:"published",media_id:p.id,error:null}).eq("id",post.id);
    } else {
      const s = await graph(a.base,`${post.container_id}?fields=status`,a.token);
      const phase = s.status?.processing_phase?.status;
      if (phase === "error") throw new Error("Facebook could not process this clip.");
      if (phase !== "complete") return "processing";
      await graph(a.base,`${a.id}/video_reels`,a.token,{upload_phase:"finish",video_id:post.container_id,video_state:"PUBLISHED",description:post.caption});
      await admin.from("studio_posts").update({status:"published",media_id:post.container_id,error:null}).eq("id",post.id);
    }
    return "published";
  } catch(e) {
    await admin.from("studio_posts").update({status:"failed",error:e instanceof Error ? e.message : "Publishing failed"}).eq("id",post.id);
    return "failed";
  }
}
export async function refreshStudioMetrics(admin: SupabaseClient<Database>, post: Post, secret: string) {
  if (!post.media_id || post.status !== "published") return;
  try {
    const a = await account(admin,post,secret);
    const fields = post.platform === "instagram" ? "like_count,comments_count" : "likes.limit(0).summary(true),comments.limit(0).summary(true)";
    const counts = await graph(a.base,`${post.media_id}?fields=${fields}`,a.token);
    const metric = post.platform === "instagram" ? "views" : "total_video_views";
    const insights = await graph(a.base,`${post.media_id}/${post.platform === "instagram" ? "insights" : "video_insights"}?metric=${metric}`,a.token);
    const views = insights.data?.find(d=>d.name===metric)?.values?.[0]?.value ?? null;
    await admin.from("studio_posts").update({views,likes:counts.like_count ?? counts.likes?.summary?.total_count ?? null,comments:counts.comments_count ?? counts.comments?.summary?.total_count ?? null,metrics_at:new Date().toISOString(),metrics_error:null}).eq("id",post.id);
  } catch(e) {
    await admin.from("studio_posts").update({metrics_error:e instanceof Error ? e.message : "Metrics unavailable"}).eq("id",post.id);
  }
}