/** Splits/joins the publishing text for a clip. Stored clip.caption is the full Instagram/Facebook text. */
export type PostText = { caption: string; description: string; hashtags: string };

const STOP = new Set("the a an and or but of to in on for with your you is are be it this that my our at by from as how why what when who not no yes makes make made even just more most really does will have about into than then them they their very every".split(" "));
const isTagLine = (line: string) => /^(#[\p{L}\p{N}_]+\s*)+$/u.test(line.trim());

export function normalizeHashtags(raw: string): string[] {
  const tags = raw.split(/[\s,]+/).map(t => t.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "")).filter(Boolean);
  return [...new Set(tags.map(t => t.toLowerCase()))].slice(0, 30).map(t => `#${t}`);
}

/** Hashtags from the AI hook title plus platform tags. */
export function suggestHashtags(title: string): string {
  const words = title.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const picked = words.filter(w => w.length > 3 && !STOP.has(w)).slice(0, 4);
  return normalizeHashtags([...picked, "shorts", "reels", "viral"].join(" ")).join(" ");
}

/** Prefills from a composed caption (caption / description / hashtag line); raw transcripts fall back to the AI title and hook. */
export function parsePostText(stored: string, title: string, reason: string): PostText {
  const blocks = stored.trim().split(/\n\s*\n/);
  const last = blocks[blocks.length - 1] || "";
  if (blocks.length >= 2 && isTagLine(last)) {
    return { caption: blocks[0]!.trim(), description: blocks.slice(1, -1).join("\n\n").trim(), hashtags: normalizeHashtags(last).join(" ") };
  }
  return { caption: title.trim(), description: reason.trim(), hashtags: suggestHashtags(title) };
}

export function composeCaption(t: PostText): string {
  const tags = normalizeHashtags(t.hashtags).join(" ");
  return [t.caption.trim(), t.description.trim(), tags].filter(Boolean).join("\n\n").slice(0, 2200);
}

/** YouTube gets the caption as title, description + hashtags as description, and bare tags. */
export function youtubeFields(t: PostText) {
  const tags = normalizeHashtags(t.hashtags);
  const title = (t.caption.trim().split("\n")[0] || "Short").replace(/[<>]/g, "").slice(0, 100);
  const description = [t.description.trim(), tags.join(" ")].filter(Boolean).join("\n\n").replace(/[<>]/g, "").slice(0, 5000);
  return { title, description, tags: tags.map(t => t.slice(1)).filter(t => t.length <= 100).slice(0, 15) };
}
