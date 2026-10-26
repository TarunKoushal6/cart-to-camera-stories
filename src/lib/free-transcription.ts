import type { Cue } from "./studio-rules";
export async function transcribeLocally(file:File,language:string,onProgress:(message:string)=>void):Promise<Cue[]> {
  if(file.size>500*1024*1024)throw new Error("Choose an audio or video file under 500 MB, or paste a transcript.");
  const context=new AudioContext();
  let audio:AudioBuffer;
  try {onProgress("Reading audio…");audio=await context.decodeAudioData(await file.arrayBuffer());}
  catch {throw new Error("This browser cannot read the audio. Upload MP3 or WAV, or paste a transcript.");}
  finally {await context.close();}
  if(audio.duration>3600)throw new Error("Split recordings longer than one hour before transcribing.");
  const offline=new OfflineAudioContext(1,Math.ceil(audio.duration*16000),16000);
  const source=offline.createBufferSource();source.buffer=audio;source.connect(offline.destination);source.start();
  const samples=(await offline.startRendering()).getChannelData(0);
  const worker=new Worker(new URL("./transcription-worker.ts",import.meta.url),{type:"module"});
  const cues:Cue[]=[];
  try {
    for(let start=0;start<samples.length;start+=30*16000){
      const part=samples.slice(start,start+30*16000),offset=start/16000;
      onProgress(`Transcribing ${Math.round(offset)} / ${Math.round(audio.duration)}s · first use downloads the free model`);
      const result=await new Promise<{chunks?:{text:string;timestamp:[number,number|null]}[];text?:string}>((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error("Transcription timed out. Paste a transcript or try a smaller file.")),300000);
        worker.onmessage=e=>{clearTimeout(timeout);e.data.error?reject(new Error(e.data.error)):resolve(e.data.result);};
        worker.onerror=()=>{clearTimeout(timeout);reject(new Error("Local speech recognition is unavailable in this browser."));};
        worker.postMessage({audio:part,language},[part.buffer]);
      });
      for(const chunk of result.chunks||[]){const end=Math.min(audio.duration,offset+(chunk.timestamp[1]??30));const begin=offset+chunk.timestamp[0];if(chunk.text.trim()&&end>begin)cues.push({start:begin,end,text:chunk.text.trim()});}
      if(!result.chunks?.length&&result.text?.trim())cues.push({start:offset,end:Math.min(audio.duration,offset+30),text:result.text.trim()});
    }
    if(!cues.length)throw new Error("No speech detected. Paste captions or choose a recording containing speech.");
    return cues;
  } finally {worker.terminate();}
}