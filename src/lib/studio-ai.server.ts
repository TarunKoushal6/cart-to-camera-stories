import { parseAiSegments, providerBaseUrl, compactTranscript, transcriptEnd, type Provider, type Cue } from "./studio-rules";
import { z } from "zod";
import { viralReviewSchema } from "./clip-review-rules";
import { AiRequestError } from "./studio-ai-default.server";

/** Lists the models a key can use, so the settings page can offer a dropdown. */
export async function fetchModels(provider: Provider, key: string, baseUrl?: string | null): Promise<string[]> {
  let endpoint: string, headers: Record<string, string>;
  if (provider === "gemini") {
    endpoint = "https://generativelanguage.googleapis.com/v1beta/models";
    headers = { "x-goog-api-key": key };
  } else if (provider === "anthropic") {
    endpoint = "https://api.anthropic.com/v1/models";
    headers = { "x-api-key": key, "anthropic-version": "2023-06-01" };
  } else {
    endpoint = `${providerBaseUrl(provider, baseUrl)}/models`;
    headers = { Authorization: `Bearer ${key}` };
  }
  const r = await fetch(endpoint, { headers, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${provider} rejected the key (${r.status}). Check the key, base URL and billing.`);
  const result = await r.json() as { data?: { id?: string }[]; models?: { name?: string; supportedGenerationMethods?: string[] }[] };
  let ids: string[] = [];
  if (provider === "gemini") {
    ids = (result.models || []).filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent")).map(m => (m.name || "").replace(/^models\//, ""));
  } else {
    ids = (result.data || []).map(m => m.id || "");
  }
  ids = [...new Set(ids.filter(Boolean))].sort();
  if (!ids.length) throw new Error("The endpoint returned no models.");
  return ids;
}

export async function analyzeWithKey(provider: Provider, model: string, key: string, cues: Cue[], baseUrl?: string | null, structure?: {title:string;duration:number;outline:string}) {
  const prompt = `Find ALL distinct high-retention (up to 15), self-contained viral hooks. Each segment MUST be 20–30 seconds, within the supplied duration. Do not invent words. Score potential 0–100, not a guaranteed prediction. Keep each title under 60 characters and each reason to one short sentence. ${cues.length?"The transcript is one line per phrase as '[MM:SS] text' (or '[H:MM:SS] text' past one hour); each stamp is when that phrase starts. Use these timestamps, and return start/end as plain seconds (e.g. [1:02:05] = 3725).":"You have NOT watched or heard this video. Suggest provisional candidate windows based ONLY on the title, duration and user outline. Every reason must start with 'Structure-only candidate: ' and disclose that speech, pacing and timing are unverified. Do not claim actual scene content."} Return ONLY JSON: {"segments":[{"title":"...","start":0,"end":25,"score":85,"reason":"..."}]}. Transcript:\n${compactTranscript(cues)}\n Structure: ${JSON.stringify(structure||null)}`;
  let endpoint: string, headers: Record<string,string>, body: object;
  if (provider === "gemini") {
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    headers = { "Content-Type": "application/json", "x-goog-api-key": key };
    body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", maxOutputTokens: 16000 } };
  } else if (provider === "anthropic") {
    endpoint = "https://api.anthropic.com/v1/messages";
    headers = { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" };
    body = { model, max_tokens: 6000, messages: [{ role: "user", content: prompt }] };
  } else {
    endpoint = `${providerBaseUrl(provider, baseUrl)}/chat/completions`;
    headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
    // Thinking models (e.g. gemini-2.5) spend output tokens on reasoning; a low default cut the JSON off mid-list.
    body = { model, max_tokens: 16000, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" } };
  }
  const r = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(240000) });
  // Do not include provider bodies: some services can echo credentials in errors.
  if (r.status === 401 || r.status === 403) throw new AiRequestError(`${provider} refused the AI key (${r.status}): it is invalid, revoked or lacks access. Save a new key in Settings.`, r.status);
  if (!r.ok) throw new AiRequestError(`${provider} rejected the analysis (${r.status}). Check your key, model, quota and billing in Settings.`, r.status);
  const result = await r.json() as { choices?: { message: { content: string } }[]; content?: { text?: string }[]; candidates?: { content: { parts: { text?: string }[] } }[] };
  const text = result.choices?.[0]?.message.content ?? result.content?.map(c=>c.text || "").join("") ?? result.candidates?.[0]?.content.parts.map(p=>p.text || "").join("");
  if (!text) throw new Error("The provider returned no segments.");
  return parseAiSegments(text, cues.length ? transcriptEnd(cues) + 1 : structure?.duration || 0);
}

export async function reviewWithKey(provider:Provider,model:string,key:string,baseUrl:string|null,title:string,cues:Cue[],caption:string,voiceover:string,duration:number) {
  const prompt=`Critique this ${duration}s short: ${JSON.stringify({title,cues,caption,voiceover})}. You have not seen the rendered video. Rate hook, pacing and retention 0-100 using ONLY this evidence. Pacing is a transcript/script estimate, not a measured visual edit. Never promise virality. Return ONLY JSON {"hook":70,"pacing":70,"retention":70,"verdict":"Viral or Needs Work","critique":"clear critique with evidence limitations","feedback":["specific actionable edit"],"evidence":"${cues.length?"transcript":"structure-only"}"}. If transcript is absent, label the critique provisional and do not invent speech or scenes.`;
  let endpoint:string,headers:Record<string,string>,body:object;
  if(provider==="gemini"){endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;headers={"Content-Type":"application/json","x-goog-api-key":key};body={contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json"}};}
  else if(provider==="anthropic"){endpoint="https://api.anthropic.com/v1/messages";headers={"Content-Type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01"};body={model,max_tokens:1800,messages:[{role:"user",content:prompt}]};}
  else{endpoint=`${providerBaseUrl(provider,baseUrl)}/chat/completions`;headers={"Content-Type":"application/json",Authorization:`Bearer ${key}`};body={model,messages:[{role:"user",content:prompt}],response_format:{type:"json_object"}};}
  const r=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
  if(!r.ok)throw new AiRequestError(`${provider} rejected the clip review (${r.status}). Check your saved model, key and quota.`,r.status);
  const result=await r.json() as {choices?:{message:{content:string}}[];content?:{text?:string}[];candidates?:{content:{parts:{text?:string}[]}}[]};
  const text=result.choices?.[0]?.message.content??result.content?.map(c=>c.text||"").join("")??result.candidates?.[0]?.content.parts.map(p=>p.text||"").join("");
  if(!text)throw new Error("Your AI returned no critique.");
  return viralReviewSchema.parse({...JSON.parse(text.replace(/^```(?:json)?\s*/,"").replace(/\s*```$/,"")),evidence:cues.length?"transcript":"structure-only"});
}

/** Writes a caption and spoken voiceover script for one clip from its transcript window. */
export async function writeClipText(provider: Provider, model: string, key: string, baseUrl: string | null | undefined, title: string, cues: Cue[]) {
  const transcript = cues.map(c => c.text).join(" ").slice(0, 6000);
  const prompt = `You write short-video copy. For the clip titled "${title}", using this transcript excerpt, return ONLY JSON: {"caption":"social caption with 3-6 hashtags, max 300 chars","voiceover":"a natural spoken voiceover script of 40-70 words matching the clip language"}. Transcript: ${transcript}`;
  let endpoint: string, headers: Record<string, string>, body: object;
  if (provider === "gemini") {
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    headers = { "Content-Type": "application/json", "x-goog-api-key": key };
    body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } };
  } else if (provider === "anthropic") {
    endpoint = "https://api.anthropic.com/v1/messages";
    headers = { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" };
    body = { model, max_tokens: 1200, messages: [{ role: "user", content: prompt }] };
  } else {
    endpoint = `${providerBaseUrl(provider, baseUrl)}/chat/completions`;
    headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
    body = { model, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" } };
  }
  const r = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  if (!r.ok) throw new AiRequestError(`${provider} rejected the request (${r.status}). Check your key and model in Settings.`, r.status);
  const result = await r.json() as { choices?: { message: { content: string } }[]; content?: { text?: string }[]; candidates?: { content: { parts: { text?: string }[] } }[] };
  const text = result.choices?.[0]?.message.content ?? result.content?.map(c=>c.text || "").join("") ?? result.candidates?.[0]?.content.parts.map(p=>p.text || "").join("");
  if (!text) throw new Error("The provider returned no text.");
  return z.object({ caption: z.string().min(1).max(2200), voiceover: z.string().min(1).max(4000) }).parse(JSON.parse(text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")));
}
