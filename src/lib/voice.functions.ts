import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { voiceInputSchema } from "./clip-review-rules";
export const generateVoiceover=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(d=>voiceInputSchema.parse(d)).handler(async({data})=>{
  const {edgeSpeech}=await import("./edge-tts.server");
  const audio=await edgeSpeech(data);
  let binary="";for(const n of audio)binary+=String.fromCharCode(n);
  return {audio:btoa(binary),mime:"audio/mpeg"};
});