import { pipeline, env } from "@huggingface/transformers";
env.allowLocalModels = false;
let recognizer: Awaited<ReturnType<typeof pipeline<"automatic-speech-recognition">>> | undefined;
self.onmessage = async (event: MessageEvent<{audio:Float32Array;language:string}>) => {
  try {
    recognizer ??= await pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny", {dtype:"q8",device:"wasm"});
    const result = await recognizer(event.data.audio, {return_timestamps:true,chunk_length_s:30,stride_length_s:5,task:"transcribe",...(event.data.language!=="auto"?{language:event.data.language}:{})});
    self.postMessage({result});
  } catch { self.postMessage({error:"Local transcription could not finish. Try a smaller audio file or paste a timed transcript."}); }
};