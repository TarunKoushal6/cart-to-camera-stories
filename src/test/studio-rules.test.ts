import {describe,it,expect} from "vitest";
import {youtubeId,segmentSchema,parseTranscript,clipCues} from "@/lib/studio-rules";
import {makeAss} from "@/lib/caption-render";
describe("Repurposing rules",()=>{
 it("accepts real YouTube URLs and rejects lookalike hosts",()=>{expect(youtubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");expect(()=>youtubeId("https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ")).toThrow();});
 it("requires at least 20 seconds",()=>{expect(segmentSchema.safeParse({title:"Hook",start:0,end:19,score:80,reason:"Hook"}).success).toBe(false);expect(segmentSchema.safeParse({title:"Hook",start:0,end:20,score:80,reason:"Hook"}).success).toBe(true);});
 it("requires no more than 30 seconds",()=>{expect(segmentSchema.safeParse({title:"Hook",start:5,end:35,score:80,reason:"Hook"}).success).toBe(true);expect(segmentSchema.safeParse({title:"Hook",start:5,end:36,score:80,reason:"Hook"}).success).toBe(false);});
 it("preserves timed multilingual captions",()=>{expect(parseTranscript("1\n00:00:05,000 --> 00:00:08,500\nनमस्ते hello")).toEqual([{start:5,end:8.5,text:"नमस्ते hello"}]);});
 it("maps source timestamps into the selected clip",()=>{expect(clipCues([{start:4,end:7,text:"hello"},{start:30,end:31,text:"bye"}],5,25)).toEqual([{start:0,end:2,text:"hello"}]);});
 it("creates word-timed karaoke for burned subtitles",()=>{expect(makeAss([{start:0,end:2,text:"hello world"}],"karaoke")).toContain("{\\k100}HELLO {\\k100}WORLD");});
});describe("AI segment parsing", () => {
  it("keeps complete clips when the AI reply is cut off mid-list", async () => {
    const { parseAiSegments } = await import("@/lib/studio-rules");
    const text = '{"segments":[{"title":"A","start":10,"end":35,"score":88,"reason":"x"},{"title":"B","start":100,"end":125,"score":70,"reason":"y"},{"title":"C","start":200,"end":2';
    expect(parseAiSegments(text, 1000).map((s) => s.title)).toEqual(["A", "B"]);
  });
  it("drops clips outside 20–60 seconds or past the video end instead of failing all", async () => {
    const { parseAiSegments } = await import("@/lib/studio-rules");
    const text = JSON.stringify({ segments: [{ title: "ok", start: 0, end: 25, score: 80.6, reason: "" }, { title: "minute", start: 100, end: 160, score: 60, reason: "" }, { title: "long", start: 0, end: 61, score: 50, reason: "" }, { title: "short", start: 300, end: 319, score: 50, reason: "" }, { title: "late", start: 990, end: 1015, score: 50, reason: "" }] });
    const r = parseAiSegments(text, 1000);
    expect(r.map((s) => s.title)).toEqual(["ok", "minute"]);
    expect(r[0]?.score).toBe(81);
  });
});
