import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchYouTube } from "@/lib/youtube.server";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function playerResponse(tracks: Array<{ languageCode: string; baseUrl: string }>) {
  return jsonResponse({
    videoDetails: { lengthSeconds: "600" },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } },
  });
}

function captionResponse(text: string) {
  return jsonResponse({ events: [{ tStartMs: 0, dDurationMs: 900, segs: [{ utf8: text }] }] });
}

function stubCaptionFetch(failHindi = false) {
  const requestedLanguages: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("youtube.com/oembed")) return jsonResponse({ title: "Video", author_name: "Creator", thumbnail_url: "https://img.youtube.com/thumb.jpg" });
    if (url.includes("youtubei/v1/player")) return playerResponse([
      { languageCode: "en", baseUrl: "https://www.youtube.com/api/timedtext?lang=en" },
      { languageCode: "hi", baseUrl: "https://www.youtube.com/api/timedtext?lang=hi" },
    ]);
    const language = new URL(url).searchParams.get("lang") || "";
    requestedLanguages.push(language);
    if (failHindi && language === "hi") return new Response("temporarily unavailable", { status: 429 });
    return captionResponse(language === "hi" ? "नमस्ते" : "Hello");
  }));
  return requestedLanguages;
}

describe("YouTube caption selection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prefers Hindi even when YouTube lists English first", async () => {
    const requested = stubCaptionFetch();
    const result = await fetchYouTube("test-video");
    expect(requested).toEqual(["hi"]);
    expect(result.transcript[0]?.text).toBe("नमस्ते");
    expect(result.transcript_status).toBe("available");
  });

  it("tries English when the preferred Hindi caption request fails", async () => {
    const requested = stubCaptionFetch(true);
    const result = await fetchYouTube("test-video");
    expect(requested).toEqual(["hi", "en"]);
    expect(result.transcript[0]?.text).toBe("Hello");
    expect(result.transcript_status).toBe("available");
  });
});