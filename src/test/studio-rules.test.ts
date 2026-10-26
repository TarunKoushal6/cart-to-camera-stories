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
});