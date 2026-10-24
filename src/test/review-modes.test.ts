import { describe, expect, it } from "vitest";
import { languageInstruction, videoAudioInstruction, validateVideoFile } from "@/lib/ugc-rules";

describe("review creation rules", () => {
  it("requests English for English AI generation", () => {
    expect(languageInstruction("english")).toContain("in English");
  });
  it("requests Hindi/Hinglish for Hindi AI generation", () => {
    expect(languageInstruction("hindi_hinglish")).toContain("Hindi/Hinglish");
  });
  it("actions mode suppresses voiceover even if text is supplied", () => {
    const instruction = videoAudioInstruction("This must never be spoken", true);
    expect(instruction).toContain("no voiceover");
    expect(instruction).not.toContain("This must never be spoken");
  });
  it("keeps custom Hindi, Hinglish and English narration intact", () => {
    for (const text of ["यह बहुत अच्छा है", "Yeh product really useful hai", "This is useful"]) {
      expect(videoAudioInstruction(text)).toContain(`"${text}"`);
    }
  });
  it("accepts external MP4 videos without generation", () => {
    expect(() => validateVideoFile({ name: "apob.mp4", type: "video/mp4", size: 1024 })).not.toThrow();
  });
  it("rejects non-MP4 uploads", () => {
    expect(() => validateVideoFile({ name: "video.webm", type: "video/webm", size: 1024 })).toThrow("MP4");
  });
  it("caps uploads at 50 MB", () => {
    expect(() => validateVideoFile({ name: "video.mp4", type: "video/mp4", size: 50 * 1024 * 1024 + 1 })).toThrow("50 MB");
  });
});