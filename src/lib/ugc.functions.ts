import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { detectSource } from "./ugc-rules";

export const addProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ url: z.string().url().max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    const source = detectSource(data.url);
    if (source === "other") throw new Error("Please paste an Amazon or Flipkart product link.");
    const { scrapeProduct, researchProduct } = await import("./firecrawl.server");
    const p = await scrapeProduct(data.url);
    const research = await researchProduct(p.title);
    const { data: row, error } = await context.supabase
      .from("products")
      .insert({ url: data.url, source, ...p, research, user_id: context.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

const ScriptSchema = z.object({
  hook: z.string(),
  voiceover_part_1: z.string(),
  voiceover_part_2: z.string(),
  scene_1: z.string(),
  scene_2: z.string(),
  caption: z.string(),
  hashtags: z.string(),
});

export const generateScript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ productId: z.string().uuid(), angle: z.string().max(300).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: p, error } = await context.supabase.from("products").select("*").eq("id", data.productId).single();
    if (error || !p) throw new Error("Product not found");
    const { generateStructured } = await import("./ai.server");
    const s = await generateStructured(
      ScriptSchema,
      `You write scripts for a faceless UGC creator who reviews unisex products on Instagram Reels from a first-person POV (only hands and the product are ever on screen). The reel is about 20 seconds in two 10-second shots.
- hook: a scroll-stopping first line (max 10 words).
- voiceover_part_1: what the narrator says in the first 10 seconds (starts with the hook, ~22 words max).
- voiceover_part_2: narrator lines for the last 10 seconds (~22 words max), ending with a soft call to action.
- scene_1 / scene_2: precise visual directions for a video generator: setting, what the hands do with the product, camera motion, lighting. Never mention faces or people's heads. Describe the product's look accurately.
- caption: Instagram caption, 1-3 short lines, honest tone, mention it's available on ${p.source === "amazon" ? "Amazon" : "Flipkart"}.
- hashtags: 8-12 relevant hashtags separated by spaces.
Be honest; base claims only on the product facts and research given.`,
      `Product: ${p.title}\nPrice: ${p.price ?? "unknown"}\nFeatures:\n${p.features || "n/a"}\n\nWeb research on real usage:\n${p.research || "n/a"}\n\n${data.angle ? `Creator's angle: ${data.angle}` : ""}`,
    );
    const { data: row, error: e2 } = await context.supabase
      .from("reviews")
      .insert({
        product_id: p.id,
        user_id: context.userId,
        hook: s.hook,
        voiceover: `${s.voiceover_part_1}\n---\n${s.voiceover_part_2}`,
        scene_1: s.scene_1,
        scene_2: s.scene_2,
        caption: s.caption,
        hashtags: s.hashtags,
        status: "scripted",
      })
      .select("id")
      .single();
    if (e2) throw new Error(e2.message);
    return { id: row.id };
  });

export const startVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ reviewId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: r } = await context.supabase.from("reviews").select("*").eq("id", data.reviewId).single();
    if (!r) throw new Error("Review not found");
    if (r.status === "rendering") return { status: r.status };
    const { createClip } = await import("./video.server");
    const [vo1] = r.voiceover.split("\n---\n");
    const job = await createClip(r.scene_1, vo1 ?? "");
    await context.supabase.from("reviews").update({ status: "rendering", stage: 1, job_id: job.id, error: null }).eq("id", r.id);
    return { status: "rendering" };
  });

export const pollVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ reviewId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: r } = await context.supabase.from("reviews").select("*").eq("id", data.reviewId).single();
    if (!r) throw new Error("Review not found");
    if (r.status !== "rendering" || !r.job_id) return { status: r.status, stage: r.stage };
    const v = await import("./video.server");
    const job = await v.getJob(r.job_id);
    if (job.status === "failed") {
      const msg = job.error?.message ?? "Video generation failed";
      await context.supabase.from("reviews").update({ status: "failed", error: msg }).eq("id", r.id);
      return { status: "failed", stage: r.stage };
    }
    if (job.status !== "completed") return { status: "rendering", stage: r.stage };
    const mp4 = await v.download(job.id);
    if (r.stage === 1) {
      const [, vo2 = ""] = r.voiceover.split("\n---\n");
      const next = await v.extendClip(mp4, r.scene_2, vo2);
      await context.supabase.from("reviews").update({ stage: 2, job_id: next.id }).eq("id", r.id);
      return { status: "rendering", stage: 2 };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const path = `${context.userId}/${r.id}.mp4`;
    const up = await supabaseAdmin.storage.from("videos").upload(path, mp4, { contentType: "video/mp4", upsert: true });
    if (up.error) throw new Error(up.error.message);
    await context.supabase.from("reviews").update({ status: "ready", video_path: path, job_id: null }).eq("id", r.id);
    return { status: "ready", stage: 2 };
  });

export const connectInstagram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ token: z.string().min(20).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { verifyToken } = await import("./instagram.server");
    const info = await verifyToken(data.token.trim());
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("instagram_accounts")
      .upsert({ user_id: context.userId, ...info, access_token: data.token.trim(), connected_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return info;
  });

export const schedulePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ reviewId: z.string().uuid(), caption: z.string().max(2200), scheduledAt: z.string().datetime().nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: r } = await context.supabase.from("reviews").select("status").eq("id", data.reviewId).single();
    if (r?.status !== "ready") throw new Error("Generate the video first.");
    const when = data.scheduledAt ?? new Date().toISOString();
    const { data: post, error } = await context.supabase
      .from("posts")
      .insert({ review_id: data.reviewId, caption: data.caption, scheduled_at: when, user_id: context.userId })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    if (!data.scheduledAt) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { advancePost } = await import("./instagram.server");
      await advancePost(supabaseAdmin, post);
    }
    return { id: post.id };
  });

export const refreshPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ postId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: post } = await context.supabase.from("posts").select("*").eq("id", data.postId).single();
    if (!post || post.status !== "processing") return { status: post?.status ?? "missing" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { advancePost } = await import("./instagram.server");
    return { status: await advancePost(supabaseAdmin, post) };
  });
