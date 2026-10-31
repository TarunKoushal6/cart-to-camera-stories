import { describe, it, expect } from "vitest";
import { workerUrl, workerStatusSchema, cloudTargetSchema, workerHealthSchema } from "@/lib/cloud-clipper-rules";
import { canApproveClip } from "@/lib/clip-review-rules";

describe("cloud clipping boundaries", () => {
  it("requires the Cutline handshake even when backed by OpenShorts", () => {
    expect(workerHealthSchema.safeParse({ok:true,protocol:"cutline-v1",protected:true,engine:"openshorts"}).success).toBe(true);
    expect(workerHealthSchema.safeParse({ok:true,protocol:"openshorts"}).success).toBe(false);
  });
  it("saves a public HTTPS endpoint and rejects local or credential-bearing URLs", () => {
    expect(workerUrl("https://creator-worker.hf.space/")).toBe("https://creator-worker.hf.space");
    for (const url of ["http://creator.hf.space", "https://127.0.0.1", "https://localhost", "https://user:token@creator.hf.space", "https://creator.hf.space?token=secret"]) expect(() => workerUrl(url)).toThrow();
  });
  it("accepts only 20–30 second render targets", () => {
    const t = {id:"00000000-0000-4000-8000-000000000001",path:"owner/clips/clip/video.mp4",upload_url:"https://uploads.example.com/object",segment:{title:"Hook",start:0,end:20,score:80,reason:"Strong hook"}};
    expect(cloudTargetSchema.safeParse(t).success).toBe(true);
    expect(cloudTargetSchema.safeParse({...t,segment:{...t.segment,end:31}}).success).toBe(false);
  });
  it("requires a persisted critique before approving an uploaded cloud clip", () => {
    expect(canApproveClip({video_path:"owner/clips/clip/video.mp4",viral_review:null})).toBe(false);
  });
  it("rejects untimed transcription output", () => {
    expect(workerStatusSchema.safeParse({status:"analyzed",duration:90,cues:[{start:5,end:4,text:"bad"}]}).success).toBe(false);
  });
});
describe("shared default worker", () => {
  it("uses the shared worker for accounts without their own", async () => {
    const { resolveWorker } = await import("@/lib/cloud-clipper.server");
    expect((await resolveWorker(undefined, "k")).url).toBe("https://interstate-boolean-pediatric-associated.trycloudflare.com");
  });
});
