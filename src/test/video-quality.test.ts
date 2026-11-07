import { describe, it, expect } from "vitest";
import { videoInspectionSchema } from "@/lib/video-quality-rules";
import { viralReviewSchema } from "@/lib/clip-review-rules";
describe("final rendered evidence", () => {
  it("limits actual final-output image evidence to five samples", () => {
    const metrics = { width:720,height:1280,duration:35,decoded:true,has_audio:true,black_seconds:0,silent_seconds:0,caption_events:20,caption_overlaps:0,music:"chill",warnings:[] };
    const frame = {second:1,jpeg:"YWJj"};
    expect(videoInspectionSchema.safeParse({metrics,frames:Array(5).fill(frame)}).success).toBe(true);
    expect(videoInspectionSchema.safeParse({metrics,frames:Array(6).fill(frame)}).success).toBe(false);
  });
  it("records actual sampled-video evidence separately from transcript-only reviews", () => {
    const review={hook:75,pacing:75,retention:75,verdict:"Needs Work",critique:"Cropped face in inspected sample",feedback:["Review framing"],evidence:"sampled-video",video_quality:{status:"Needs Work",frames_checked:5,visual_notes:"Face cut off",limitations:"Samples only; audio unverified"}};
    expect(viralReviewSchema.parse(review).video_quality?.frames_checked).toBe(5);
    expect(viralReviewSchema.safeParse({...review,video_quality:{...review.video_quality,frames_checked:6}}).success).toBe(false);
  });
});