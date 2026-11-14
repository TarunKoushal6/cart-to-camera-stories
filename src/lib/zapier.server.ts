import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { decrypt } from "./studio-crypto.server";
import { dueSlotKey, pickRandom, wantsZapier, zapierWebhook } from "./zapier-rules";

type Admin = SupabaseClient<Database>;
export async function sendRandomZapierReel(admin: Admin, userId: string) {
  const { data: owner, error: ownerError } = await admin.auth.admin.getUserById(userId);
  if (ownerError || !wantsZapier(owner.user?.email)) throw new Error("Zapier isn't available for this account.");
  const secret = process.env["STUDIO_ENCRYPTION_KEY"];
  if (!secret) throw new Error("Secure connection storage is unavailable.");
  const { data: cred, error: credError } = await admin.from("studio_credentials").select("encrypted_key").eq("user_id", userId).eq("kind", "zapier").maybeSingle();
  if (credError || !cred) throw new Error("Save your Zapier webhook first.");
  const url = zapierWebhook(await decrypt(cred.encrypted_key, secret));
  const { data: previous, error: previousError } = await admin.from("zapier_deliveries").select("clip_id").eq("user_id", userId);
  if (previousError) throw new Error("Couldn't read reel delivery history.");
  const used = new Set((previous ?? []).map(x => x.clip_id));
  const { data: pool, error: poolError } = await admin.from("studio_clips").select("id,title,caption,video_path,start_seconds,end_seconds").eq("user_id", userId).not("video_path", "is", null).order("created_at", { ascending: false });
  if (poolError) throw new Error("Couldn't read saved reels.");
  const candidates = (pool ?? []).filter(c => !used.has(c.id));
  // Unique delivery records also prevent manual and scheduled sends claiming the same reel.
  while (candidates.length) {
    const clip = pickRandom(candidates);
    if (!clip?.video_path) break;
    candidates.splice(candidates.indexOf(clip), 1);
    const { data: signed, error: signError } = await admin.storage.from("videos").createSignedUrl(clip.video_path, 604800);
    if (signError || !signed) throw new Error("Couldn't open this saved reel.");
    const { data: claim, error: claimError } = await admin.from("zapier_deliveries").insert({ user_id: userId, clip_id: clip.id }).select("id").single();
    if (claimError?.code === "23505") continue;
    if (claimError || !claim) throw new Error("Couldn't reserve this reel for delivery.");
    let result: string;
    let status: "accepted" | "failed" | "unknown";
    try {
      const response = await fetch(url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(25000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        event: "reel_ready", delivery_id: claim.id, clip_id: clip.id, title: clip.title, caption: clip.caption || clip.title,
        video_url: signed.signedUrl, video_url_expires_at: new Date(Date.now() + 604800000).toISOString(), duration_seconds: clip.end_seconds - clip.start_seconds,
        timestamp: new Date().toISOString(), triggered_from: "cutline",
      }) });
      status = response.ok ? "accepted" : "failed";
      result = response.ok ? `“${clip.title}” sent to Zapier. Check the Zap's run history to confirm posting.` : `Zapier rejected the request (HTTP ${response.status}). Check the Zap's run history before retrying.`;
      await response.body?.cancel();
    } catch {
      status = "unknown";
      result = `Delivery for “${clip.title}” is unconfirmed. Check Zapier's run history; this reel won't resend automatically.`;
    }
    const { error: updateError } = await admin.from("zapier_deliveries").update({ status }).eq("id", claim.id).eq("user_id", userId);
    if (updateError) throw new Error("Delivery history couldn't be updated. Check Zapier before sending again.");
    return result;
  }
  return "No unsent saved reels left.";
}

export async function runDueZapier(admin: Admin, now = new Date()) {
  const { data: rows, error } = await admin.from("zapier_autopost").select("*").eq("enabled", true);
  if (error) throw new Error("Couldn't read Zapier schedules.");
  let processed = 0;
  for (const row of rows ?? []) {
    const { data: owner } = await admin.auth.admin.getUserById(row.user_id);
    if (!wantsZapier(owner.user?.email)) continue;
    const key = dueSlotKey(row.slots, row.timezone, now, row.last_slot_key);
    if (!key) continue;
    let query = admin.from("zapier_autopost").update({ last_slot_key: key, updated_at: now.toISOString() }).eq("user_id", row.user_id).eq("enabled", true);
    query = row.last_slot_key === null ? query.is("last_slot_key", null) : query.eq("last_slot_key", row.last_slot_key);
    const { data: claimed } = await query.select("user_id");
    if (!claimed?.length) continue;
    let result: string;
    try { result = await sendRandomZapierReel(admin, row.user_id); } catch (e) { result = e instanceof Error ? e.message : "Zapier send failed."; }
    await admin.from("zapier_autopost").update({ last_result: `${key}: ${result}` }).eq("user_id", row.user_id);
    processed++;
  }
  return processed;
}