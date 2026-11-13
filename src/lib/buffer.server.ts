import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { decrypt } from "./studio-crypto.server";
import { dueSlotKey, pickRandom } from "./buffer-rules";

export type BufferChannel = { id: string; name: string; service: string; avatar?: string | null };

export async function bufferGql<T>(key: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const r = await fetch("https://api.buffer.com", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(25000),
  });
  const text = await r.text();
  if (!r.ok) { console.error(`Buffer failed [${r.status}]: ${text}`); throw new Error(r.status === 401 ? "Buffer rejected the API key." : `Buffer error [${r.status}]: ${text.slice(0, 300)}`); }
  const json = JSON.parse(text) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`Buffer: ${json.errors.map(e => e.message).join("; ")}`);
  return json.data as T;
}

export async function listChannels(key: string): Promise<BufferChannel[]> {
  const a = await bufferGql<{ account: { organizations: { id: string }[] } }>(key, "query{account{organizations{id name}}}");
  const out: BufferChannel[] = [];
  for (const org of a.account.organizations) {
    const c = await bufferGql<{ channels: { id: string; name: string; displayName?: string; service: string; avatar?: string }[] }>(key,
      "query($id:OrganizationId!){channels(input:{organizationId:$id}){id name displayName service avatar}}", { id: org.id });
    out.push(...c.channels.map(x => ({ id: x.id, name: x.displayName || x.name, service: x.service, avatar: x.avatar ?? null })));
  }
  return out;
}

function metadataFor(service: string, title: string) {
  if (service === "instagram") return { instagram: { type: "reel", shouldShareToFeed: true } };
  if (service === "facebook") return { facebook: { type: "reel" } };
  if (service === "youtube") return { youtube: { title: title.slice(0, 100) || "Short", categoryId: "22" } };
  return undefined;
}

export async function sendVideo(key: string, channel: BufferChannel, text: string, title: string, url: string) {
  const res = await bufferGql<{ createPost: { post?: { id: string }; message?: string } }>(key,
    `mutation($input:CreatePostInput!){createPost(input:$input){... on PostActionSuccess{post{id}} ... on MutationError{message}}}`,
    { input: { text, channelId: channel.id, schedulingType: "automatic", mode: "shareNow", assets: [{ video: { url } }], metadata: metadataFor(channel.service, title) } });
  if (!res.createPost.post) throw new Error(res.createPost.message || "Buffer did not accept the post.");
  return res.createPost.post.id;
}

export async function bufferKey(admin: SupabaseClient<Database>, userId: string) {
  const secret = process.env["STUDIO_ENCRYPTION_KEY"];
  if (!secret) throw new Error("Secure credential storage is not configured.");
  const { data } = await admin.from("studio_credentials").select("encrypted_key").eq("user_id", userId).eq("kind", "buffer").maybeSingle();
  if (!data) throw new Error("Save your Buffer API key first.");
  return decrypt(data.encrypted_key, secret);
}

/** Posts one random unposted reel to every chosen Buffer channel. Enabling auto-post is the owner's approval for these reels. */
export async function postRandomReel(admin: SupabaseClient<Database>, userId: string, channelIds: string[]) {
  if (!channelIds.length) throw new Error("Pick at least one Buffer channel.");
  const key = await bufferKey(admin, userId);
  const { data: pool } = await admin.from("studio_clips").select("id,title,caption,video_path").eq("user_id", userId)
    .not("video_path", "is", null).is("buffer_posted_at", null).limit(500);
  const clip = pickRandom(pool || []);
  if (!clip?.video_path) return "No unposted reels left — generate more clips.";
  const { data: signed, error } = await admin.storage.from("videos").createSignedUrl(clip.video_path, 60 * 60 * 24 * 7);
  if (error || !signed) throw new Error("Couldn't read the saved reel.");
  const channels = (await listChannels(key)).filter(c => channelIds.includes(c.id));
  const text = (clip.caption || clip.title || "").slice(0, 2200);
  const errors: string[] = [];
  for (const ch of channels) {
    try { await sendVideo(key, ch, text, clip.title || "", signed.signedUrl); }
    catch (e) { errors.push(`${ch.service}: ${e instanceof Error ? e.message : "failed"}`); }
  }
  const sent = channels.length - errors.length;
  const stamp = new Date().toISOString();
  await admin.from("studio_clips").update(sent ? { buffer_posted_at: stamp, buffer_error: errors.join(" | ") || null, approved_at: stamp } : { buffer_error: errors.join(" | ") || null }).eq("id", clip.id).eq("user_id", userId);
  return `"${clip.title}" → ${sent}/${channels.length} channels${errors.length ? ` · ${errors.join(" | ")}` : ""}`;
}

export async function runDueAutoposts(admin: SupabaseClient<Database>, now = new Date()) {
  const { data: rows } = await admin.from("buffer_autopost").select("*").eq("enabled", true).limit(200);
  let n = 0;
  for (const row of rows || []) {
    const key = dueSlotKey(row.slots, row.timezone, now, row.last_slot_key);
    if (!key) continue;
    // Claim the slot first so overlapping ticks never double-post.
    const { data: claimed } = await admin.from("buffer_autopost").update({ last_slot_key: key, updated_at: now.toISOString() })
      .eq("user_id", row.user_id).or(`last_slot_key.is.null,last_slot_key.neq.${key}`).select("user_id");
    if (!claimed?.length) continue;
    let result: string;
    try { result = await postRandomReel(admin, row.user_id, row.channel_ids); } catch (e) { result = e instanceof Error ? e.message : "Failed"; }
    await admin.from("buffer_autopost").update({ last_result: `${key}: ${result}` }).eq("user_id", row.user_id);
    n++;
  }
  return n;
}
