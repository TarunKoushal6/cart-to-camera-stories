import { describe, it, expect } from "vitest";
import { workerUrl, workerStatusSchema, cloudTargetSchema, workerHealthSchema, workerHttpError, isStoppedJob, STOPPED_MESSAGE } from "@/lib/cloud-clipper-rules";
import { canApproveClip } from "@/lib/clip-review-rules";

describe("cloud clipping boundaries", () => {
  it("treats only owner-stopped failed jobs as stopped", () => {
    expect(isStoppedJob("failed", STOPPED_MESSAGE)).toBe(true);
    expect(isStoppedJob("failed", "Worker failed")).toBe(false);
    expect(isStoppedJob("rendering", STOPPED_MESSAGE)).toBe(false);
  });
  it("explains HTTP 429 as a full worker queue", () => {
    expect(workerHttpError(429)).toMatch(/queue is full/);
  });
  it("explains HTTP 530 as an offline tunnel or worker server", () => {
    expect(workerHttpError(530)).toMatch(/Cloudflare tunnel/);
    expect(workerHttpError(530)).toMatch(/Uvicorn/);
    expect(workerHttpError(502)).not.toMatch(/Cloudflare tunnel/);
  });
  it("requires the Cutline handshake even when backed by OpenShorts", () => {
    expect(workerHealthSchema.safeParse({ok:true,protocol:"cutline-v1",protected:true,engine:"openshorts"}).success).toBe(true);
    expect(workerHealthSchema.safeParse({ok:true,protocol:"openshorts"}).success).toBe(false);
  });
  it("saves a public HTTPS endpoint and rejects local or credential-bearing URLs", () => {
    expect(workerUrl("https://creator-worker.hf.space/")).toBe("https://creator-worker.hf.space");
    for (const url of ["http://creator.hf.space", "https://127.0.0.1", "https://localhost", "https://user:token@creator.hf.space", "https://creator.hf.space?token=secret"]) expect(() => workerUrl(url)).toThrow();
  });
  it("accepts only 20–60 second render targets", () => {
    const t = {id:"00000000-0000-4000-8000-000000000001",path:"owner/clips/clip/video.mp4",upload_url:"https://uploads.example.com/object",segment:{title:"Hook",start:0,end:20,score:80,reason:"Strong hook"}};
    expect(cloudTargetSchema.safeParse(t).success).toBe(true);
    expect(cloudTargetSchema.safeParse({...t,segment:{...t.segment,end:61}}).success).toBe(false);
    expect(cloudTargetSchema.safeParse({...t,segment:{...t.segment,end:60}}).success).toBe(true);
  });
  it("requires a persisted critique before approving an uploaded cloud clip", () => {
    expect(canApproveClip({video_path:"owner/clips/clip/video.mp4",viral_review:null})).toBe(true);
  });
  it("rejects untimed transcription output", () => {
    expect(workerStatusSchema.safeParse({status:"analyzed",duration:90,cues:[{start:5,end:4,text:"bad"}]}).success).toBe(false);
  });
});
describe("shared default worker", () => {
  it("uses the shared worker for accounts without their own", async () => {
    const { resolveWorker } = await import("@/lib/cloud-clipper.server");
    expect((await resolveWorker(undefined, "k")).url).toBe("https://periodically-reproduced-owned-controller.trycloudflare.com");
  });
});
describe("worker download progress", () => {
  it("shows size, speed and percent while downloading", async () => {
    const { progressSummary } = await import("@/lib/cloud-clipper-rules");
    const s = progressSummary({ stage: "downloading", progress: { downloaded: 512 * 1024 ** 2, total: 1024 ** 3, speed: 5 * 1024 ** 2, eta: 120 } });
    expect(s?.percent).toBe(50);
    expect(s?.label).toContain("512 MB / 1.0 GB (50%)");
    expect(s?.label).toContain("5.0 MB/s (42 Mbps)");
    expect(s?.label).toContain("2 min left");
  });
  it("ignores unknown worker stages instead of failing the job", async () => {
    const { workerStatusSchema } = await import("@/lib/cloud-clipper-rules");
    expect(workerStatusSchema.parse({ status: "transcribing", stage: "mystery" }).stage).toBeUndefined();
  });
});
describe("download stats", () => {
  it("shows size with percent, speed in MB/s and Mbps, and ETA", async () => {
    const { downloadStats } = await import("@/lib/cloud-clipper-rules");
    const d = downloadStats({ stage: "downloading", progress: { downloaded: 1.2 * 1024 ** 3, total: 2.4 * 1024 ** 3, speed: 2e6, eta: 45 } });
    expect(d?.size).toBe("1.2 GB / 2.4 GB (50%)");
    expect(d?.speed).toBe("1.9 MB/s (16 Mbps)");
    expect(d?.eta).toBe("45s left");
  });
});
describe("cloud job steps", () => {
  it("shows the download step with percent from worker progress", async () => {
    const { cloudJobProgress } = await import("@/lib/cloud-clipper-rules");
    const v = cloudJobProgress("transcribing", { stage: "downloading", progress: { downloaded: 256, total: 1024 } });
    expect(v.step).toBe(0);
    expect(v.label).toBe("Download video");
    expect(v.percent).toBe(25);
  });
  it("maps AI selection and rendering to their own steps", async () => {
    const { cloudJobProgress } = await import("@/lib/cloud-clipper-rules");
    expect(cloudJobProgress("analyzing", null).label).toBe("AI hook selection");
    const r = cloudJobProgress("rendering", { rendered: 3, total: 12 });
    expect(r.step).toBe(3);
    expect(r.percent).toBe(25);
    expect(cloudJobProgress("ready", null).step).toBe(5);
  });
  it("treats subtitle fetching as the speech/captions step", async () => {
    const { cloudJobProgress } = await import("@/lib/cloud-clipper-rules");
    expect(cloudJobProgress("transcribing", { stage: "fetching_subtitles" }).label).toBe("Captions");
  });
});
describe("long transcripts", () => {
  it("accepts 75,000 words from the worker", async () => {
    const { workerStatusSchema } = await import("@/lib/cloud-clipper-rules");
    const cues = Array.from({ length: 75000 }, (_, i) => ({ start: i * 0.2, end: i * 0.2 + 0.2, text: "w" }));
    expect(workerStatusSchema.safeParse({ status: "analyzed", cues }).success).toBe(true);
    expect(workerStatusSchema.safeParse({ status: "analyzed", cues: [...cues, cues[0]] }).success).toBe(false);
  });
  it("sends the AI compact [MM:SS] lines, with hours past one hour", async () => {
    const { compactTranscript, transcriptEnd } = await import("@/lib/studio-rules");
    const text = compactTranscript([
      { start: 65, end: 65.4, text: "Hello" }, { start: 65.4, end: 66, text: "everyone." },
      { start: 3725, end: 3726, text: "Next" }, { start: 3726, end: 3727, text: "part" },
    ]);
    expect(text).toBe("[01:05] Hello everyone.\n[1:02:05] Next part");
    expect(transcriptEnd(Array.from({ length: 75000 }, (_, i) => ({ start: i, end: i + 1, text: "w" })))).toBe(75000);
  });
});
