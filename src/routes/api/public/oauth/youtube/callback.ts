import { createFileRoute } from "@tanstack/react-router";
export const Route=createFileRoute("/api/public/oauth/youtube/callback")({server:{handlers:{GET:async({request})=>{
  let success=false;
  try{
    const url=new URL(request.url),state=url.searchParams.get("state"),code=url.searchParams.get("code");
    if(!state||state.length>200||!code||code.length>4000)throw new Error("Invalid OAuth response");
    const {stateHash,googleConfig,channel,YOUTUBE_SCOPES}=await import("@/lib/youtube-publishing.server");
    const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
    // Atomic single-use state consumption authorizes this callback for its app user.
    const {data:s}=await supabaseAdmin.from("youtube_oauth_states").delete().eq("state_hash",await stateHash(state)).gt("expires_at",new Date().toISOString()).select("user_id,redirect_uri").maybeSingle();
    if(!s)throw new Error("Expired OAuth state");
    const config=googleConfig();
    const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,code,redirect_uri:s.redirect_uri,grant_type:"authorization_code"}),signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw new Error("Google consent failed");
    const t=await r.json() as {access_token:string;refresh_token?:string;expires_in:number;scope:string};
    if(!t.refresh_token||!YOUTUBE_SCOPES.every(scope=>t.scope.split(" ").includes(scope)))throw new Error("Required access not granted");
    const c=await channel(t.access_token);const {encrypt}=await import("@/lib/studio-crypto.server");
    const {error}=await supabaseAdmin.from("youtube_connections").upsert({user_id:s.user_id,channel_id:c.id,channel_name:c.snippet.title,encrypted_tokens:await encrypt(JSON.stringify({access_token:t.access_token,refresh_token:t.refresh_token,expires_at:Date.now()+t.expires_in*1000}),config.secret),updated_at:new Date().toISOString()});
    if(error)throw new Error("Connection storage failed");success=true;
  }catch{/* Never expose authorization codes, tokens, or raw provider responses. */}
  const html=`<!doctype html><html><head><title>YouTube connection — Cutline</title></head><body><p>${success?"YouTube connected. You may close this window.":"YouTube connection failed or expired. Close this window and try again; grant upload and channel access."}</p><script>if(window.opener){window.opener.postMessage({type:"cutline-youtube-connected",success:${success}},window.location.origin);window.close();}</script></body></html>`;
  return new Response(html,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'none'; script-src 'unsafe-inline'; frame-ancestors 'none'"}});
}}}});