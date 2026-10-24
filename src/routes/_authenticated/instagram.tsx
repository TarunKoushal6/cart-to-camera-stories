import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { connectInstagram } from "@/lib/ugc.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/instagram")({
  head: () => ({
    meta: [
      { title: "Instagram — POVreel" },
      { name: "description", content: "Connect your Instagram professional account to post reels." },
      { property: "og:title", content: "Instagram — POVreel" },
      { property: "og:description", content: "Connect your Instagram professional account to post reels." },
    ],
  }),
  component: IG,
});

function IG() {
  const qc = useQueryClient();
  const connect = useServerFn(connectInstagram);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: ig } = useQuery({
    queryKey: ["ig"],
    queryFn: async () => (await supabase.from("instagram_accounts").select("username, connected_at").maybeSingle()).data,
  });

  async function onConnect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await connect({ data: { token } });
      toast.success(`Connected @${r.username}`);
      setToken("");
      qc.invalidateQueries({ queryKey: ["ig"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't connect");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-4xl font-bold">Instagram</h1>
      {ig && (
        <div className="mt-6 rounded-xl border border-primary/40 bg-card p-4 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-primary" />
          <div className="flex-1">Connected as <b>@{ig.username}</b></div>
          <Button variant="ghost" size="sm" onClick={async () => { await supabase.from("instagram_accounts").delete().neq("user_id", ""); qc.invalidateQueries({ queryKey: ["ig"] }); }}>
            Disconnect
          </Button>
        </div>
      )}

      <ol className="mt-6 space-y-3 text-sm text-muted-foreground list-decimal pl-5">
        <li>In the Instagram app, switch your new account to a <b className="text-foreground">Professional (Creator or Business)</b> account.</li>
        <li>Go to <a className="text-primary underline" href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">Meta for Developers</a>, create an app and add the <b className="text-foreground">Instagram</b> product (“API setup with Instagram login”).</li>
        <li>Under “Generate access tokens”, add your Instagram account and click <b className="text-foreground">Generate token</b>.</li>
        <li>Paste that token below.</li>
      </ol>

      <form onSubmit={onConnect} className="mt-6 flex gap-2">
        <Input type="password" placeholder="Instagram access token" value={token} onChange={(e) => setToken(e.target.value)} required />
        <Button disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : ig ? "Replace" : "Connect"}</Button>
      </form>
      <p className="mt-2 text-xs text-muted-foreground">Tokens last about 60 days — paste a fresh one here when it expires.</p>
    </div>
  );
}
