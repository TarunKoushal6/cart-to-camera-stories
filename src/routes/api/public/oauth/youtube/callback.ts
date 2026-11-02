import { createFileRoute } from "@tanstack/react-router";

/** A user-safe failure: its message is shown on the callback page. Never put codes or tokens in it. */
class CallbackError extends Error {}
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export const Route=createFileRoute("/api/public/oauth/youtube/callback")({server:{handlers:{GET:async({request})=>{
  let success=false,reason="";
  try{
    const url=new URL(request.url),state=url.searchParams.get("state"),code=url.searchParams.get("code"),denied=url.searchParams.get("error");
    if(denied)throw new CallbackError(denied==="access_denied"?"You cancelled or denied access on the Google screen.":`Google returned an error: ${denied.slice(0,80)}.`);
    if(!state||state.length>200||!code||code.length>4000)throw new CallbackError("Google's response was missing the sign-in code. Start Connect YouTube again from the app.");
    const {stateHash,googleConfig,channel,YOUTUBE_SCOPES}=await import("@/lib/youtube-publishing.server");
    const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
    // Atomic single-use state consumption authorizes this callback for its app user.
    const {data:s}=await supabaseAdmin.from("youtube_oauth_states").delete().eq("state_hash",await stateHash(state)).gt("expires_at",new Date().toISOString()).select("user_id,redirect_uri").maybeSingle();
    if(!s)throw new CallbackError("This connect link expired (10 minutes) or was already used. Click Connect YouTube again.");
    let config;
    try{config=googleConfig();}catch(e){throw new CallbackError(e instanceof Error?e.message:"YouTube setup is incomplete.");}
    const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,code,redirect_uri:s.redirect_uri,grant_type:"authorization_code"}),signal:AbortSignal.timeout(20000)});
    if(!r.ok){
      // Google's token errors are codes like invalid_grant / redirect_uri_mismatch / invalid_client — safe to show.
      const body=await r.json().catch(()=>null) as {error?:string;error_description?:string}|null;
      const hint=body?.error==="redirect_uri_mismatch"?` Add ${s.redirect_uri} as an authorized redirect URI in Google Cloud.`:body?.error==="invalid_client"?" Check the YouTube client ID and secret saved in the app.":body?.error==="invalid_grant"?" The code expired or was already used; try connecting again.":"";
      throw new CallbackError(`Google token exchange failed (${r.status}${body?.error?`: ${body.error}`:""}${body?.error_description?` — ${body.error_description.slice(0,200)}`:""}).${hint}`);
    }
    const t=await r.json() as {access_token:string;refresh_token?:string;expires_in:number;scope?:string};
    const granted=(t.scope||"").split(" ");
    const missing=YOUTUBE_SCOPES.filter(scope=>!granted.includes(scope));
    if(missing.length)throw new CallbackError(`Required access was not granted: ${missing.map(m=>m.split("/").pop()).join(", ")}. Tick every checkbox on the Google screen and try again.`);
    const {encrypt,decrypt}=await import("@/lib/studio-crypto.server");
    let refreshToken=t.refresh_token;
    if(!refreshToken){
      // Google often omits refresh_token on re-consent; keep the one already saved for this user.
      const {data:existing}=await supabaseAdmin.from("youtube_connections").select("encrypted_tokens").eq("user_id",s.user_id).maybeSingle();
      if(existing){try{refreshToken=(JSON.parse(await decrypt(existing.encrypted_tokens,config.secret)) as {refresh_token?:string}).refresh_token;}catch{/* unreadable old tokens: treated as missing */}}
    }
    if(!refreshToken)throw new CallbackError("Google didn't grant offline access (no refresh token). Remove this app at myaccount.google.com/permissions, then click Connect YouTube again.");
    let c;
    try{c=await channel(t.access_token);}catch(e){throw new CallbackError(e instanceof Error?e.message:"Couldn't read your YouTube channel.");}
    const {error}=await supabaseAdmin.from("youtube_connections").upsert({user_id:s.user_id,channel_id:c.id,channel_name:c.snippet.title,encrypted_tokens:await encrypt(JSON.stringify({access_token:t.access_token,refresh_token:refreshToken,expires_at:Date.now()+t.expires_in*1000}),config.secret),updated_at:new Date().toISOString()});
    if(error){console.error("[youtube-oauth] storage failed:",error.message);throw new CallbackError("Couldn't save the YouTube connection. Try again.");}
    success=true;
  }catch(e){
    // Never expose authorization codes or tokens; only CallbackError messages are shown.
    reason=e instanceof CallbackError?e.message:"Unexpected error while connecting YouTube. Try again.";
    console.error("[youtube-oauth] callback failed:",e instanceof Error?e.message:String(e));
  }
  const text=success?"YouTube connected. You may close this window.":`YouTube connection failed: ${reason}`;
  const html=`<!doctype html><html><head><title>YouTube connection — Cutline</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;line-height:1.5"><h1 style="font-size:20px">${success?"Connected":"Connection failed"}</h1><p>${escapeHtml(text)}</p>${success?"":"<p>Close this window and try again.</p>"}<script>if(window.opener){window.opener.postMessage({type:"cutline-youtube-connected",success:${success},error:${JSON.stringify(success?null:reason).replace(/</g,"\\u003c")}},window.location.origin);${success?"window.close();":""}}</script></body></html>`;
  return new Response(html,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'"}});
}}}});
