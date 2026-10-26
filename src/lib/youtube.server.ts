import type { Cue } from "./studio-rules";

export async function fetchYouTube(id: string) {
  const url = `https://www.youtube.com/watch?v=${id}`;
  const info = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, { signal: AbortSignal.timeout(15000) });
  if (!info.ok) throw new Error("This video is private, unavailable, or YouTube could not return its details.");
  const metadata = await info.json() as { title: string; author_name: string; thumbnail_url: string };
  let transcript: Cue[] = [], duration: number | null = null;
  try {
    const r = await fetch("https://www.youtube.com/youtubei/v1/player", { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000), body: JSON.stringify({ videoId: id, context: { client: { clientName: "WEB", clientVersion: "2.20261025.01.00", hl: "en" } } }) });
    const player = await r.json() as { videoDetails?: { lengthSeconds?: string }; captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: { baseUrl: string; languageCode: string }[] } } };
    duration = Number(player.videoDetails?.lengthSeconds) || null;
    const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const track = tracks.find(t => t.languageCode === "en") ?? tracks[0];
    if (track) {
      const trackUrl = new URL(track.baseUrl);
      if (!trackUrl.hostname.endsWith("youtube.com") && !trackUrl.hostname.endsWith("googlevideo.com")) throw new Error("Invalid caption host");
      trackUrl.searchParams.set("fmt", "json3");
      const text = await fetch(trackUrl, { signal: AbortSignal.timeout(15000) });
      const captions = await text.json() as { events?: { tStartMs: number; dDurationMs?: number; segs?: { utf8: string }[] }[] };
      transcript = (captions.events || []).filter(e => e.segs && e.dDurationMs).map(e => ({ start: e.tStartMs/1000, end: (e.tStartMs+(e.dDurationMs || 0))/1000, text: (e.segs || []).map(s => s.utf8).join("").trim() })).filter(c => c.text.length > 0);
    }
  } catch { /* Free captions are not always accessible; retain usable metadata. */ }
  return { title: metadata.title, author: metadata.author_name, thumbnail_url: metadata.thumbnail_url, duration, transcript, transcript_status: transcript.length ? "available" : "unavailable" };
}