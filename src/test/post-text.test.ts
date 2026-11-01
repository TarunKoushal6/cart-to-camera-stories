import { describe, it, expect } from "vitest";
import { parsePostText, composeCaption, youtubeFields, normalizeHashtags } from "@/lib/post-text-rules";

describe("clip publishing text", () => {
  it("prefills a raw transcript caption from the AI title and hook", () => {
    const t = parsePostText(">> so this goes like yeah", "Your Phone Makes People Dislike You", "Phones lower trust.");
    expect(t.caption).toBe("Your Phone Makes People Dislike You");
    expect(t.description).toBe("Phones lower trust.");
    expect(t.hashtags).toContain("#shorts");
    expect(t.hashtags).toContain("#phone");
  });

  it("round-trips a composed caption", () => {
    const text = { caption: "Hook line", description: "Why it matters", hashtags: "#focus #shorts" };
    expect(parsePostText(composeCaption(text), "x", "y")).toEqual(text);
  });

  it("normalizes hashtags with or without #", () => {
    expect(normalizeHashtags("focus, #Focus ##brain")).toEqual(["#focus", "#brain"]);
  });

  it("maps to YouTube title (max 100), description with hashtags, and bare tags", () => {
    const y = youtubeFields({ caption: "A".repeat(150), description: "Desc", hashtags: "#one #two" });
    expect(y.title).toHaveLength(100);
    expect(y.description).toBe("Desc\n\n#one #two");
    expect(y.tags).toEqual(["one", "two"]);
  });
});
