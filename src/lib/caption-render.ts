import type { Cue } from "./studio-rules";
import wasm from "@/assets/ffmpeg-core.wasm.asset.json";

export type CaptionStyle = "karaoke" | "bold" | "clean";
function assTime(n:number){ return `${Math.floor(n/3600)}:${String(Math.floor(n/60)%60).padStart(2,"0")}:${(n%60).toFixed(2).padStart(5,"0")}`; }
export function makeAss(cues:Cue[],style:CaptionStyle) {
  const header=`[Script Info]\nScriptType: v4.00+\nPlayResX: 720\nPlayResY: 1280\nWrapStyle: 0\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Barlow,${style==="clean"?42:58},&H0000F4D7,&H00FFFFFF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,2,48,48,240,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const rows:string[]=[];
  for(const cue of cues){
    const words=cue.text.replace(/[{}\\]/g,"").split(/\s+/).filter(Boolean);
    for(let i=0;i<words.length;i+=5){
      const chunk=words.slice(i,i+5);
      const span=(cue.end-cue.start)/Math.max(words.length,1);
      const start=cue.start+i*span,end=Math.min(cue.end,start+chunk.length*span);
      const text=chunk.map(w=>style==="karaoke"?`{\\k${Math.max(1,Math.round(span*100))}}${w.toUpperCase()}`:style==="bold"?w.toUpperCase():w).join(" ");
      rows.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${text}`);
    }
  }
  return header+rows.join("\n");
}
export async function renderClip(file:File,start:number,end:number,cues:Cue[],style:CaptionStyle,framing:"center"|"left"|"right",onProgress:(n:number)=>void) {
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
    const filter=`scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280:${x}:(ih-oh)/2,setsar=1,ass=captions.ass:fontsdir=fonts`;
    const code=await ffmpeg.exec(["-ss",String(start),"-i","input.mp4","-t",String(end-start),"-vf",filter,"-c:v","libx264","-preset","ultrafast","-crf","23","-c:a","aac","-movflags","+faststart","output.mp4"]);
    if(code!==0) throw new Error("Video export failed. Try a smaller MP4 source.");
    const bytes=await ffmpeg.readFile("output.mp4");
    if(typeof bytes==="string") throw new Error("Invalid video output.");
    onProgress(100);
    return new File([new Uint8Array(bytes)],"cutline-short.mp4",{type:"video/mp4"});
  } finally {ffmpeg.terminate();blobs.forEach(u=>URL.revokeObjectURL(u));}
}