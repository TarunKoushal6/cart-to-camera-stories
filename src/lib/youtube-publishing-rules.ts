import { z } from "zod";
export const youtubePublishSchema = z.object({
  clipId: z.string().uuid(), title: z.string().trim().min(1).max(100).regex(/^[^<>]+$/),
  description: z.string().max(5000).regex(/^[^<>]*$/),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).refine(tags=>tags.join(",").length<=500,"Tags must total at most 500 characters."),
  privacy: z.enum(["public","unlisted","private"]), scheduledAt: z.string().datetime().nullable(),
  madeForKids: z.boolean(),
}).refine(d=>!d.scheduledAt || d.privacy==="public","Scheduled releases must be public.");
export type YouTubePublishInput = z.infer<typeof youtubePublishSchema>;
export function youtubeMetadata(data: YouTubePublishInput) {
  return { snippet: {title:data.title,description:data.description,tags:data.tags,categoryId:"22"},
    status: { privacyStatus: data.scheduledAt?"private":data.privacy, selfDeclaredMadeForKids:data.madeForKids,
      ...(data.scheduledAt?{publishAt:data.scheduledAt}:{}) } };
}
export function youtubeCounts(stats: Record<string,string> = {}) {
  const count=(name:string)=>stats[name]===undefined?null:Number(stats[name]);
  return {views:count("viewCount"),likes:count("likeCount"),comments:count("commentCount")};
}