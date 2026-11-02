import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { detectSource, languageInstruction, MAX_VIDEO_BYTES } from "./ugc-rules";

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
  .inputValidator((d) => z.object({
    productId: z.string().uuid(), angle: z.string().max(300).optional(),
    mode: z.enum(["ai", "custom", "actions", "upload"]).default("ai"),
    language: z.enum(["english", "hindi_hinglish"]).default("english"),
    voiceover1: z.string().max(5000).default(""), voiceover2: z.string().max(5000).default(""),
    scene1: z.string().max(5000).default(""), scene2: z.string().max(5000).default(""),
  }).superRefine((d, ctx) => {
    if (d.mode === "custom" && !d.voiceover1.trim()) ctx.addIssue({ code: "custom", message: "Paste your custom script." });
    if (d.mode === "custom" && (!d.scene1.trim() || !d.scene2.trim())) ctx.addIssue({ code: "custom", message: "Add both visual shot directions." });
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: p, error } = await context.supabase.from("products").select("*").eq("id", data.productId).single();
    if (error || !p) throw new Error("Product not found");
    let s = { hook: "", voiceover_part_1: data.voiceover1, voiceover_part_2: data.voiceover2, scene_1: data.scene1, scene_2: data.scene2, caption: "", hashtags: "" };
    if (data.mode === "ai" || data.mode === "actions") {
    const { generateStructured } = await import("./ai.server");
    s = await generateStructured(
      ScriptSchema,
      `You write scripts for a faceless UGC creator who reviews unisex products on Instagram Reels from a first-person POV (only hands and the product are ever on screen). The reel is about 20 seconds in two 10-second shots.
${languageInstruction(data.language)}
- hook: a scroll-stopping first line (max 10 words).
- voiceover_part_1: what the narrator says in the first 10 seconds (starts with the hook, ~22 words max).
- voiceover_part_2: narrator lines for the last 10 seconds (~22 words max), ending with a soft call to action.
- scene_1 / scene_2: precise visual directions for a video generator: setting, what the hands do with the product, camera motion, lighting. Never mention faces or people's heads. Describe the product's look accurately.
- caption: Instagram caption, 1-3 short lines, honest tone, mention it's available on ${p.source === "amazon" ? "Amazon" : "Flipkart"}.
- hashtags: 8-12 relevant hashtags separated by spaces.
Be honest; base claims only on the product facts and research given.
${data.mode === "actions" ? "ACTIONS ONLY MODE: Override all spoken-line instructions: hook, voiceover_part_1 and voiceover_part_2 MUST be empty strings. Generate only visual shot directions and hands demonstrating the product; no narration, dialogue, speech or vocals. Still generate caption and hashtags in the selected language." : ""}`,
      `Product: ${p.title}\nPrice: ${p.price ?? "unknown"}\nFeatures:\n${p.features || "n/a"}\n\nWeb research on real usage:\n${p.research || "n/a"}\n\n${data.angle ? `Creator's angle: ${data.angle}` : ""}`,
    );
    }
    if (data.mode === "actions" || data.mode === "upload") { s.voiceover_part_1 = ""; s.voiceover_part_2 = ""; }
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
        script_mode: data.mode,
        language: data.language,
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
    if (r.script_mode === "upload") throw new Error("Upload an external video for this review.");
    if (!r.scene_1.trim() || !r.scene_2.trim()) throw new Error("Add both visual shot directions first.");
    const { createClip } = await import("./video.server");
    const [vo1] = r.voiceover.split("\n---\n");
    const job = await createClip(r.scene_1, vo1 ?? "", r.script_mode === "actions");
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
      const next = await v.extendClip(mp4, r.scene_2, vo2, r.script_mode === "actions");
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
  .inputValidator((d) => z.object({ token: z.string().trim().min(20).max(1000) }).parse(d))
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

export const saveReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    reviewId: z.string().uuid(), voiceover1: z.string().max(5000), voiceover2: z.string().max(5000),
    scene1: z.string().max(5000), scene2: z.string().max(5000),
    caption: z.string().max(2200), hashtags: z.string().max(2200),
  }).refine((d) => `${d.caption}\n\n${d.hashtags}`.trim().length <= 2200, "Caption and hashtags must fit within 2,200 characters.").parse(d))
  .handler(async ({ data, context }) => {
    const { data: r, error } = await context.supabase.from("reviews").select("status, script_mode").eq("id", data.reviewId).single();
    if (error || !r) throw new Error("Review not found");
    if (r.status === "rendering") throw new Error("Wait for video generation to finish before editing.");
    const silent = r.script_mode === "actions" || r.script_mode === "upload";
    const { error: updateError } = await context.supabase.from("reviews").update({
      voiceover: silent ? "\n---\n" : `${data.voiceover1}\n---\n${data.voiceover2}`,
      scene_1: data.scene1, scene_2: data.scene2, caption: data.caption, hashtags: data.hashtags,
    }).eq("id", data.reviewId).neq("status", "rendering");
    if (updateError) throw new Error(updateError.message);
    return { saved: true };
  });

export const finishVideoUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ reviewId: z.string().uuid(), path: z.string().max(300) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: r, error } = await context.supabase.from("reviews").select("id, status").eq("id", data.reviewId).single();
    if (error || !r) throw new Error("Review not found");
    if (r.status === "rendering") throw new Error("Wait for video generation to finish before uploading.");
    const prefix = `${context.userId}/${r.id}/`;
    if (!data.path.startsWith(prefix) || !/^[a-f0-9-]+\.mp4$/.test(data.path.slice(prefix.length))) throw new Error("Invalid video upload path");
    const filename = data.path.slice(prefix.length);
    const { data: files, error: listError } = await context.supabase.storage.from("videos").list(prefix.slice(0, -1), { search: filename });
    const file = files?.find((f) => f.name === filename);
    if (listError || !file || file.metadata?.mimetype !== "video/mp4" || !file.metadata?.size || file.metadata.size > MAX_VIDEO_BYTES) throw new Error("Upload a valid MP4 video up to 50 MB first.");
    const { error: updateError } = await context.supabase.from("reviews").update({ status: "ready", video_path: data.path, job_id: null, error: null, stage: 2 }).eq("id", r.id).neq("status", "rendering");
    if (updateError) throw new Error(updateError.message);
    return { status: "ready" };
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
