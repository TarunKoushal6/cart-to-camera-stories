import { edgeGec, EDGE_TOKEN } from "./edge-token.server";
import { voiceInputSchema } from "./clip-review-rules";

type SpeechSocket = {accept():void;send(data:string):void;close():void;addEventListener(type:string,cb:(event:{data:unknown})=>void):void};
const escapeXml=(text:string)=>text.replace(/[<>&"']/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&apos;"})[c]||c);
/** Unofficial Microsoft Edge consumer speech service; no paid fallback or automatic retries. */
export async function edgeSpeech(input:unknown):Promise<Uint8Array> {
  const {text,voice}=voiceInputSchema.parse(input);
  const id=crypto.randomUUID().replace(/-/g,"");
  const url=`https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${EDGE_TOKEN}&ConnectionId=${id}&Sec-MS-GEC=${edgeGec(Date.now()/1000)}&Sec-MS-GEC-Version=2-143.0.3650.75`;
  const response=await fetch(url,{headers:{Upgrade:"websocket",Origin:"chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold","User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0","Accept-Language":"en-US,en;q=0.9"},signal:AbortSignal.timeout(20000)});
  const socket=(response as Response & {webSocket?:SpeechSocket}).webSocket;
  if(response.status!==101||!socket)throw new Error(`Edge voice service unavailable (${response.status}). Keep your script or upload an MP3; no paid service was used.`);
  socket.accept();
  return new Promise((resolve,reject)=>{
    let done=false,size=0;const chunks:Uint8Array[]=[];
    const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timer);socket.close();if(error){reject(error);return;}if(!size){reject(new Error("Edge returned no audio. Upload an MP3; no paid service was used."));return;}const audio=new Uint8Array(size);let offset=0;for(const c of chunks){audio.set(c,offset);offset+=c.length;}resolve(audio);};
    const timer=setTimeout(()=>finish(new Error("Edge voice generation timed out. Try again later or upload an MP3.")),45000);
    socket.addEventListener("error",()=>finish(new Error("Edge voice generation disconnected. Upload an MP3.")));
    socket.addEventListener("close",()=>{if(!done)finish(new Error("Edge voice service closed before finishing."));});
    socket.addEventListener("message",event=>{
      if(typeof event.data==="string"){if(event.data.includes("Path:turn.end"))finish();return;}
      if(!(event.data instanceof ArrayBuffer))return;
      const data=new Uint8Array(event.data);if(data.length<2)return;
      const length=(data[0]<<8)|data[1];if(length+2>data.length)return;
      const header=new TextDecoder().decode(data.slice(2,length+2));
      if(!header.includes("Path:audio")||!header.includes("audio/mpeg"))return;
      const payload=data.slice(length+2);size+=payload.length;
      if(size>8*1024*1024){finish(new Error("Generated speech is too large. Use a shorter script."));return;}chunks.push(payload);
    });
    const timestamp=new Date().toUTCString();
    socket.send(`X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify({context:{synthesis:{audio:{metadataoptions:{sentenceBoundaryEnabled:"false",wordBoundaryEnabled:"false"},outputFormat:"audio-24khz-48kbitrate-mono-mp3"}}}})}\r\n`);
    socket.send(`X-RequestId:${id}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}Z\r\nPath:ssml\r\n\r\n<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${voice.slice(0,5)}"><voice name="${voice}"><prosody pitch="+0Hz" rate="+0%" volume="+0%">${escapeXml(text)}</prosody></voice></speak>`);
  });
}