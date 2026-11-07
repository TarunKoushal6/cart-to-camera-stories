import type { Cue } from "./studio-rules";
import { captionTimeline } from "./caption-timeline";
import wasm from "@/assets/ffmpeg-core.wasm.asset.json";

export type CaptionStyle = "karaoke" | "bold" | "clean";
function assTime(n:number){ return `${Math.floor(n/3600)}:${String(Math.floor(n/60)%60).padStart(2,"0")}:${(n%60).toFixed(2).padStart(5,"0")}`; }
const WHITE="&H00FFFFFF";
/** Electric cyan, neon lime, warm amber gold (ASS colours are &HAABBGGRR). */
export const CAPTION_ACCENTS=["&H00FFFF00","&H0000FF33","&H0000D7FF"] as const;
type Word={start:number;end:number;text:string};
/** NFC keeps Devanagari matras attached; toUpperCase() leaves Devanagari untouched. */
const clean=(w:string)=>w.replace(/[{}\\]/g,"").normalize("NFC").trim();
export function captionGroups(words:Word[]):Word[][]{
  const groups:Word[][]=[];let cur:Word[]=[];
  for(const w of words){
    const prev=cur[cur.length-1];
    if(prev){
      const chars=cur.reduce((n,x)=>n+x.text.length+1,0)+w.text.length;
      const gap=w.start-prev.end;
      const endsSentence=/[.!?।,]$/.test(prev.text);
      if(cur.length>=4||gap>0.6||(cur.length>=3&&(chars>22||endsSentence))){groups.push(cur);cur=[];}
    }
    cur.push(w);
  }
  if(cur.length)groups.push(cur);
  return groups;
}
export function makeAss(cues:Cue[],style:CaptionStyle) {
  const header=`[Script Info]\nScriptType: v4.00+\nPlayResX: 720\nPlayResY: 1280\nWrapStyle: 0\nScaledBorderAndShadow: yes\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Barlow,${style==="clean"?42:48},${WHITE},${WHITE},&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,4,2,2,50,50,380,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const words:Word[]=[];
  for(const cue of captionTimeline(cues)){
    const parts=cue.text.split(/\s+/).map(clean).filter(Boolean);
    const span=(cue.end-cue.start)/Math.max(parts.length,1);
    parts.forEach((t,k)=>words.push({start:cue.start+k*span,end:cue.start+(k+1)*span,text:style==="clean"?t:t.toUpperCase()}));
  }
  const rows:string[]=[];
  captionGroups(words).forEach((group,gi)=>{
    const accent=CAPTION_ACCENTS[gi%CAPTION_ACCENTS.length];
    const first=group[0],last=group[group.length-1];
    if(!first||!last)return;
    const groupEnd=last.end;
    if(style!=="karaoke"){rows.push(`Dialogue: 0,${assTime(first.start)},${assTime(groupEnd)},Default,,0,0,0,,${group.map(w=>w.text).join(" ")}`);return;}
    group.forEach((w,i)=>{
      const end=group[i+1]?.start??groupEnd;
      if(end-w.start<0.01)return;
      const text=group.map((x,j)=>j===i?`{\\c${accent}}${x.text}{\\c${WHITE}}`:x.text).join(" ");
      rows.push(`Dialogue: 0,${assTime(w.start)},${assTime(end)},Default,,0,0,0,,${text}`);
    });
  });
  return header+rows.join("\n");
}
export async function renderClip(file:File,start:number,end:number,cues:Cue[],style:CaptionStyle,framing:"center"|"left"|"right",onProgress:(n:number)=>void,voiceover?:File|null) {
  const {FFmpeg}=await import("@ffmpeg/ffmpeg");
  const {fetchFile,toBlobURL}=await import("@ffmpeg/util");
  const ffmpeg=new FFmpeg();
  const blobs:string[]=[];
  try {
    ffmpeg.on("progress",({progress})=>onProgress(Math.max(0,Math.min(99,Math.round(progress*100)))));
    const coreURL=await toBlobURL("/ffmpeg/ffmpeg-core.js","text/javascript"); blobs.push(coreURL);
    const wasmURL=await toBlobURL(wasm.url,"application/wasm"); blobs.push(wasmURL);
    await ffmpeg.load({coreURL,wasmURL});
    await ffmpeg.createDir("fonts");
    await ffmpeg.writeFile("fonts/Barlow-Bold.ttf",await fetchFile("/ffmpeg/caption-font.ttf"));
    await ffmpeg.writeFile("input.mp4",await fetchFile(file));
    await ffmpeg.writeFile("captions.ass",new TextEncoder().encode(makeAss(cues,style)));
    const x=framing==="left"?"0":framing==="right"?"iw-ow":"(iw-ow)/2";
    const filter=`scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920:${x}:(ih-oh)/2,setsar=1,ass=captions.ass:fontsdir=fonts`;
    const args=["-ss",String(start),"-i","input.mp4"];
    if(voiceover){await ffmpeg.writeFile("voiceover",await fetchFile(voiceover));args.push("-i","voiceover");}
    args.push("-t",String(end-start),"-vf",filter,"-c:v","libx264","-preset","ultrafast","-crf","23");
    if(voiceover)args.push("-map","0:v","-map","1:a","-shortest");
    args.push("-c:a","aac","-movflags","+faststart","output.mp4");
    const code=await ffmpeg.exec(args);
    if(code!==0) throw new Error("Video export failed. Try a smaller MP4 source.");
    const bytes=await ffmpeg.readFile("output.mp4");
    if(typeof bytes==="string") throw new Error("Invalid video output.");
    onProgress(100);
    return new File([new Uint8Array(bytes)],"cutline-short.mp4",{type:"video/mp4"});
  } finally {ffmpeg.terminate();blobs.forEach(u=>URL.revokeObjectURL(u));}
}