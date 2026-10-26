import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Scissors, CalendarClock, Instagram, LogOut, BarChart3, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: Layout,
});

const nav = [
  { to: "/dashboard", label: "Studio", icon: Scissors },
  { to: "/schedule", label: "Posts", icon: CalendarClock },
  { to: "/instagram", label: "Instagram", icon: Instagram },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings2 },
] as const;

function Layout() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !session) navigate({ to: "/" });
  }, [loading, session, navigate]);
  if (loading || !session) return <div className="min-h-screen" />;

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="border-b md:border-b-0 md:border-r border-border bg-sidebar p-3 md:p-5 flex flex-wrap md:flex-nowrap md:flex-col gap-1">
        <div className="font-display text-lg font-bold px-2 md:mb-6 mr-auto md:mr-0">
          <span className="flex items-center gap-2"><Scissors className="h-5 w-5 text-primary"/>Cutline<span className="text-primary">.</span></span>
        </div>
        {nav.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            activeProps={{ className: "bg-sidebar-accent text-foreground" }}
          >
            <n.icon className="h-4 w-4" />
            <span className="hidden sm:inline">{n.label}</span>
          </Link>
        ))}
        <Button variant="ghost"
          onClick={() => supabase.auth.signOut()}
          className="md:mt-auto flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Sign out</span>
        </Button>
      </aside>
      <main className="p-5 lg:p-10 max-w-7xl w-full min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
