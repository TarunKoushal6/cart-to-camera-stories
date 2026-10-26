import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Hand, Link2, Sparkles, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Cutline — YouTube to Shorts and Reels" },
      { name: "description", content: "Repurpose YouTube videos into vertical clips with captions and social publishing." },
      { property: "og:title", content: "Cutline — YouTube to Shorts and Reels" },
      { property: "og:description", content: "Repurpose YouTube videos into vertical clips with captions and social publishing." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) navigate({ to: "/dashboard" });
  }, [loading, session, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } =
      mode === "in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    if (mode === "up" && !data.session) toast.success("Check your email to confirm your account.");
  }

  async function google() {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (r.error) toast.error(r.error.message ?? "Google sign-in failed");
  }

  return (
    <main className="min-h-screen grid lg:grid-cols-[1fr_1fr]">
      <section className="p-8 lg:p-16 flex flex-col justify-center border-b lg:border-b-0 lg:border-r border-border">
        <div className="font-display text-5xl font-bold">Cutline<span className="text-primary">.</span></div>
        <h1 className="font-display text-3xl font-bold mt-8">YouTube to Shorts & Reels</h1>
        <p className="mt-4 text-muted-foreground max-w-md">Your moments. Your voice. Your next short.</p>
      </section>
      <section className="p-8 lg:p-16 flex items-center">
        <div className="w-full max-w-sm mx-auto">
          <h2 className="font-display text-3xl font-bold">{mode === "in" ? "Sign in" : "Create account"}</h2>
          <Button variant="outline" className="w-full mt-6" onClick={google}>
            Continue with Google
          </Button>
          <div className="my-4 text-center text-xs text-muted-foreground">or</div>
          <form onSubmit={submit} className="space-y-3">
            <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            <Button className="w-full" disabled={busy}>
              {busy ? "…" : mode === "in" ? "Sign in" : "Sign up"}
            </Button>
          </form>
          <Button variant="ghost" className="mt-4 text-sm text-muted-foreground hover:text-foreground" onClick={() => setMode(mode === "in" ? "up" : "in")}>
            {mode === "in" ? "New here? Create an account" : "Have an account? Sign in"}
          </Button>
        </div>
      </section>
    </main>
  );
}
