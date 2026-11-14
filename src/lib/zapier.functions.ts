import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeSlots, requireZapierConsent, wantsZapier, zapierWebhook } from "./zapier-rules";

export const getZapierAutopost = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data: owner } = await context.supabase.auth.getUser();
  if (!wantsZapier(owner.user?.email)) return { allowed: false, connected: false, settings: null };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: cred, error: credError } = await supabaseAdmin.from("studio_credentials").select("user_id").eq("user_id", context.userId).eq("kind", "zapier").maybeSingle();
  const { data: settings, error } = await context.supabase.from("zapier_autopost").select("*").eq("user_id", context.userId).maybeSingle();
  if (error || credError) throw new Error("Couldn't load Zapier settings.");
  return { allowed: true, connected: !!cred, settings };
});

export const saveZapierWebhook = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ url: z.string().max(2000) }).parse(d)).handler(async ({ data, context }) => {
    const { data: owner } = await context.supabase.auth.getUser();
    if (!wantsZapier(owner.user?.email)) throw new Error("Zapier isn't available for this account.");
    const url = zapierWebhook(data.url), secret = process.env["STUDIO_ENCRYPTION_KEY"];
    if (!secret) throw new Error("Secure connection storage is unavailable.");
    const { encrypt } = await import("./studio-crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("studio_credentials").upsert({ user_id: context.userId, kind: "zapier", provider: "zapier", encrypted_key: await encrypt(url, secret), updated_at: new Date().toISOString() });
    if (error) throw new Error("Couldn't save Zapier webhook.");
    // A changed destination needs fresh scheduling consent.
    await context.supabase.from("zapier_autopost").update({ enabled: false }).eq("user_id", context.userId);
    return { saved: true };
  });

export const saveZapierSchedule = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ enabled: z.boolean(), consent: z.boolean(), slots: z.array(z.string()).max(6), timezone: z.string().min(1).max(60) }).parse(d)).handler(async ({ data, context }) => {
    const { data: owner } = await context.supabase.auth.getUser();
    if (!wantsZapier(owner.user?.email)) throw new Error("Zapier isn't available for this account.");
    if (data.enabled) requireZapierConsent(data.consent);
    try { new Intl.DateTimeFormat("en", { timeZone: data.timezone }); } catch { throw new Error("Unknown time zone."); }
    const slots = normalizeSlots(data.slots);
    if (slots.length !== new Set(data.slots).size || !slots.length) throw new Error("Choose valid daily times.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cred } = await supabaseAdmin.from("studio_credentials").select("user_id").eq("user_id", context.userId).eq("kind", "zapier").maybeSingle();
    if (data.enabled && !cred) throw new Error("Save a Zapier webhook first.");
    const { error } = await context.supabase.from("zapier_autopost").upsert({ user_id: context.userId, enabled: data.enabled, slots, timezone: data.timezone, updated_at: new Date().toISOString() });
    if (error) throw new Error("Couldn't save schedule.");
    return { saved: true };
  });

export const sendRandomToZapier = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ consent: z.boolean() }).parse(d)).handler(async ({ data, context }) => {
    const { data: owner } = await context.supabase.auth.getUser();
    if (!wantsZapier(owner.user?.email)) throw new Error("Zapier isn't available for this account.");
    requireZapierConsent(data.consent);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendRandomZapierReel } = await import("./zapier.server");
    const result = await sendRandomZapierReel(supabaseAdmin, context.userId);
    await context.supabase.from("zapier_autopost").update({ last_result: result }).eq("user_id", context.userId);
    return { result };
  });

export const disconnectZapier = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data: owner } = await context.supabase.auth.getUser();
  if (!wantsZapier(owner.user?.email)) throw new Error("Zapier isn't available for this account.");
  const { error: disableError } = await context.supabase.from("zapier_autopost").update({ enabled: false }).eq("user_id", context.userId);
  if (disableError) throw new Error("Couldn't stop the Zapier schedule.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("studio_credentials").delete().eq("user_id", context.userId).eq("kind", "zapier");
  if (error) throw new Error("Couldn't remove the Zapier webhook.");
  return { disconnected: true };
});