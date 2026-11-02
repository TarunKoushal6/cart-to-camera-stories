import { describe, expect, it } from "vitest";
import { isFinalPhase, needsReconnect, phasePercent, publishPhase } from "@/lib/publish-progress-rules";

describe("publish progress phases", () => {
  it("shows uploading before the post row exists", () => expect(publishPhase(undefined)).toBe("uploading"));
  it("maps processing rows to the processing phase", () => expect(publishPhase({ status: "processing" })).toBe("processing"));
  it("maps published rows to published at 100%", () => {
    expect(publishPhase({ status: "published" })).toBe("published");
    expect(phasePercent("published")).toBe(100);
  });
  it("keeps future scheduled posts as scheduled, overdue ones as uploading", () => {
    expect(publishPhase({ status: "scheduled", scheduled_at: new Date(Date.now() + 3600_000).toISOString() })).toBe("scheduled");
    expect(publishPhase({ status: "scheduled", scheduled_at: new Date(Date.now() - 1000).toISOString() })).toBe("uploading");
  });
  it("stops polling only on final phases", () => {
    expect(isFinalPhase("failed")).toBe(true);
    expect(isFinalPhase("processing")).toBe(false);
  });
  it("offers reconnect for expired Meta tokens but not processing errors", () => {
    expect(needsReconnect("Meta: Error validating access token: Session has expired (code 190, subcode 463)")).toBe(true);
    expect(needsReconnect("Instagram could not process this clip.")).toBe(false);
  });
});
