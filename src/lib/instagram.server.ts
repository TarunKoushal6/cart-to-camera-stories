import type { SupabaseClient } from "@supabase/supabase-js";
import { metaErrorMessage } from "./meta-error";

const IG = "https://graph.instagram.com/v23.0";

async function ig(path: string, init?: RequestInit) {
  const res = await fetch(`${IG}${path}`, init);
  const t = await res.text();
  if (!res.ok) {
    console.error(`Instagram ${path.split("?")[0]} failed [${res.status}]: ${t}`);
    throw new Error(metaErrorMessage(res.status, t, "Instagram"));
  }
  return JSON.parse(t);
}

export async function verifyToken(token: string) {
  const me = await ig(`/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`);
  return { ig_user_id: String(me.user_id ?? me.id), username: String(me.username ?? "") };
}

type Post = { id: string; user_id: string; review_id: string; caption: string; status: string; ig_container_id: string | null };

/** Moves one post forward: scheduled → processing (container created) → published. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function advancePost(admin: SupabaseClient<any>, post: Post) {
  try {
    const { data: acct } = await admin.from("instagram_accounts").select("ig_user_id, access_token").eq("user_id", post.user_id).maybeSingle();
    if (!acct) throw new Error("Instagram is not connected");
    const token = encodeURIComponent(acct.access_token);

    if (post.status === "scheduled") {
      const { data: review } = await admin.from("reviews").select("video_path").eq("id", post.review_id).single();
      if (!review?.video_path) throw new Error("Video is not ready");
      const { data: signed, error } = await admin.storage.from("videos").createSignedUrl(review.video_path, 60 * 60 * 24);
      if (error || !signed) throw new Error("Couldn't prepare the video link");
      const params = new URLSearchParams({ media_type: "REELS", video_url: signed.signedUrl, caption: post.caption, access_token: acct.access_token });
      const c = await ig(`/${acct.ig_user_id}/media`, { method: "POST", body: params });
      await admin.from("posts").update({ status: "processing", ig_container_id: c.id, error: null }).eq("id", post.id);
      return "processing";
    }

    if (post.status === "processing" && post.ig_container_id) {
      const s = await ig(`/${post.ig_container_id}?fields=status_code,status&access_token=${token}`);
      if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram couldn't process the video: ${s.status ?? s.status_code}`);
      if (s.status_code !== "FINISHED") return "processing";
      const p = await ig(`/${acct.ig_user_id}/media_publish`, {
        method: "POST",
        body: new URLSearchParams({ creation_id: post.ig_container_id, access_token: acct.access_token }),
      });
      await admin.from("posts").update({ status: "published", ig_media_id: p.id, error: null }).eq("id", post.id);
      return "published";
    }
    return post.status;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("posts").update({ status: "failed", error: msg }).eq("id", post.id);
    return "failed";
  }
}
