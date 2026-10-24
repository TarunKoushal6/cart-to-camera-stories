import { videoAudioInstruction } from "./ugc-rules";

const BASE = "https://ai.gateway.lovable.dev/v1/videos";
const MODEL = "google/gemini-omni-1.1-flash";

export type Job = { id: string; status: string; error?: { code: string; message: string } };

function key() {
  const k = process.env["LOVABLE_API_KEY"];
  if (!k) throw new Error("AI is not configured");
  return k;
}

async function asJob(res: Response): Promise<Job> {
  if (!res.ok) {
    const t = await res.text();
    console.error(`Video request failed [${res.status}]: ${t}`);
    let msg = t;
    try { msg = JSON.parse(t).message ?? t; } catch { /* keep text */ }
    throw new Error(`Video service error (${res.status}): ${msg}`);
  }
  return res.json();
}

const STYLE =
  "Vertical 9:16 first-person POV smartphone footage for an Instagram Reel product review. Only the creator's hands and the product are visible — never show a face or a person's head. Natural lighting, realistic home setting, micro-detail on the product. Single continuous shot.";

export async function createClip(scene: string, voiceover: string, silent = false) {
  return asJob(
    await fetch(BASE, {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        input: `${STYLE}\n\nScene: ${scene}\n\n${videoAudioInstruction(voiceover, silent)}`,
        response_format: { type: "video", resolution: "720p", duration: "10s", aspect_ratio: "9:16" },
      }),
    }),
  );
}

export async function extendClip(mp4: Uint8Array, scene: string, voiceover: string, silent = false) {
  return asJob(
    await fetch(BASE, {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        input: [
          { type: "video", data: toBase64(mp4), mime_type: "video/mp4" },
          {
            type: "text",
            text: `The scene continues in the same first-person POV, hands only, no faces. ${scene}\n${videoAudioInstruction(voiceover, silent)}`,
          },
        ],
        response_format: { type: "video", resolution: "720p", duration: "10s" },
      }),
    }),
  );
}

export async function getJob(id: string) {
  return asJob(await fetch(`${BASE}/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${key()}` } }));
}

export async function download(id: string) {
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}/content`, { headers: { Authorization: `Bearer ${key()}` } });
  if (!res.ok) throw new Error(`Video download failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
