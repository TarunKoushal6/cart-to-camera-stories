export type Source = "amazon" | "flipkart" | "other";

export type ScriptMode = "ai" | "custom" | "actions" | "upload";
export type ScriptLanguage = "english" | "hindi_hinglish";
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export function languageInstruction(language: ScriptLanguage) {
  return language === "hindi_hinglish"
    ? "Write spoken lines and captions in natural Hindi/Hinglish (Hindi with conversational English; Devanagari or Roman Hindi)."
    : "Write spoken lines and captions in English.";
}

export function videoAudioInstruction(voiceover: string, silent = false) {
  if (silent) return "Audio: no voiceover, no narration, no dialogue, no speech or vocals. Only quiet natural product-handling sounds. Focus exclusively on the hand actions.";
  return `Audio: a friendly off-camera narrator says exactly: "${voiceover}". Preserve the script's language and pronunciation. Light instrumental background music; no other speech.`;
}

export function validateVideoFile(file: { size: number; type: string; name: string }) {
  if (!file.name.toLowerCase().endsWith(".mp4") || (file.type && file.type !== "video/mp4")) throw new Error("Choose an MP4 video.");
  if (file.size === 0 || file.size > MAX_VIDEO_BYTES) throw new Error("Choose a non-empty MP4 video up to 50 MB.");
}

/** Only Amazon and Flipkart product links are accepted. */
export function detectSource(url: string): Source {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "other";
  }
  if (/(^|\.)amazon\.[a-z.]+$/.test(host) || host === "amzn.in" || host === "amzn.to" || host === "a.co") return "amazon";
  if (/(^|\.)flipkart\.com$/.test(host) || host === "fkrt.it" || host === "dl.flipkart.com") return "flipkart";
  return "other";
}
