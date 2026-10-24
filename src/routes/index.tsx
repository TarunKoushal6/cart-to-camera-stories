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
      { title: "POVreel — Faceless product review reels on autopilot" },
      { name: "description", content: "Paste an Amazon or Flipkart link, get a researched POV script and video, and post it to Instagram." },
      { property: "og:title", content: "POVreel — Faceless product review reels on autopilot" },
      { property: "og:description", content: "Paste an Amazon or Flipkart link, get a researched POV script and video, and post it to Instagram." },
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

  const steps = [
    { icon: Link2, t: "Paste a link", d: "Amazon or Flipkart. We read the page and research real usage online." },
    { icon: Sparkles, t: "Get a POV script", d: "Hook, voiceover and shot directions written for a faceless creator." },
    { icon: Hand, t: "Generate the reel", d: "~20s first-person video — hands and product only." },
    { icon: Send, t: "Post or schedule", d: "Straight to your Instagram as a Reel." },
  ];

  return (
    <main className="min-h-screen grid lg:grid-cols-[1.2fr_1fr]">
      <section className="p-8 lg:p-16 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-border">
        <div className="font-display text-xl font-bold tracking-tight">
          POV<span className="text-primary">reel</span>
        </div>
        <div className="my-16">
          <h1 className="font-display text-5xl lg:text-7xl font-bold leading-[0.95] tracking-tight">
            Review products.
            <br />
            <span className="text-primary">Never show your face.</span>
          </h1>
          <p className="mt-6 max-w-lg text-lg text-muted-foreground">
            A studio for faceless UGC: researched scripts, POV video reviews, and Instagram posting in one place.
          </p>
        </div>
        <ol className="grid sm:grid-cols-2 gap-4">
          {steps.map((s, i) => (
            <li key={s.t} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="font-display text-primary">0{i + 1}</span>
                <s.icon className="h-4 w-4" />
              </div>
              <div className="mt-2 font-display font-bold">{s.t}</div>
              <p className="text-sm text-muted-foreground">{s.d}</p>
            </li>
          ))}
        </ol>
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
          <button className="mt-4 text-sm text-muted-foreground hover:text-foreground" onClick={() => setMode(mode === "in" ? "up" : "in")}>
            {mode === "in" ? "New here? Create an account" : "Have an account? Sign in"}
          </button>
        </div>
      </section>
    </main>
  );
}
