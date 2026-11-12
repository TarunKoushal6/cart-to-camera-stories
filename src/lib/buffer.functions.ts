import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeSlots } from "./buffer-rules";

export const saveBufferKey = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ key: z.string().min(10).max(3000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { listChannels } = await import("./buffer.server");
    const channels = await listChannels(data.key.trim());
    const secret = process.env["STUDIO_ENCRYPTION_KEY"];
    if (!secret) throw new Error("Secure credential storage is not configured.");
    const { encrypt } = await import("./studio-crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("studio_credentials").upsert({ user_id: context.userId, kind: "buffer", provider: "buffer",
      account_name: `${channels.length} channels`, encrypted_key: await encrypt(data.key.trim(), secret), updated_at: new Date().toISOString() });
    if (error) throw new Error("Couldn't save Buffer key.");
    return { channels: channels.length };
  });

export const getBufferAutopost = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cred } = await supabaseAdmin.from("studio_credentials").select("user_id").eq("user_id", context.userId).eq("kind", "buffer").maybeSingle();
    const { data: settings } = await context.supabase.from("buffer_autopost").select("*").eq("user_id", context.userId).maybeSingle();
    const { count: remaining } = await context.supabase.from("studio_clips").select("id", { count: "exact", head: true })
      .not("video_path", "is", null).is("buffer_posted_at", null);
    let channels: { id: string; name: string; service: string }[] = [];
    let channelError: string | null = null;
    if (cred) {
      try { const { listChannels, bufferKey } = await import("./buffer.server"); channels = await listChannels(await bufferKey(supabaseAdmin, context.userId)); }
      catch (e) { channelError = e instanceof Error ? e.message : "Couldn't load Buffer channels."; }
    }
    return { connected: !!cred, channels, channelError, remaining: remaining || 0, settings: settings ? {
      enabled: settings.enabled, slots: settings.slots, timezone: settings.timezone, channelIds: settings.channel_ids, lastResult: settings.last_result } : null };
  });

export const saveBufferAutopost = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ enabled: z.boolean(), slots: z.array(z.string()).max(12), timezone: z.string().max(60), channelIds: z.array(z.string().max(100)).max(20) }).parse(d))
  .handler(async ({ data, context }) => {
    try { new Intl.DateTimeFormat("en", { timeZone: data.timezone }); } catch { throw new Error("Unknown time zone."); }
    const slots = normalizeSlots(data.slots);
    if (data.enabled && (!slots.length || !data.channelIds.length)) throw new Error("Add at least one time and one channel.");
    const { error } = await context.supabase.from("buffer_autopost").upsert({ user_id: context.userId, enabled: data.enabled, slots,
      timezone: data.timezone, channel_ids: data.channelIds, updated_at: new Date().toISOString() });
    if (error) throw new Error("Couldn't save auto-post settings.");
    return { slots };
  });

export const postRandomNow = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: settings } = await context.supabase.from("buffer_autopost").select("channel_ids").eq("user_id", context.userId).maybeSingle();
    const { postRandomReel } = await import("./buffer.server");
    const result = await postRandomReel(supabaseAdmin, context.userId, settings?.channel_ids || []);
    await supabaseAdmin.from("buffer_autopost").update({ last_result: `Manual: ${result}` }).eq("user_id", context.userId);
    return { result };
  });
