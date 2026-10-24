import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { LayoutGrid, CalendarClock, Instagram, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: Layout,
});

const nav = [
  { to: "/dashboard", label: "Products", icon: LayoutGrid },
  { to: "/schedule", label: "Posts", icon: CalendarClock },
  { to: "/instagram", label: "Instagram", icon: Instagram },
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
      <aside className="border-b md:border-b-0 md:border-r border-border bg-sidebar p-4 flex md:flex-col gap-2 md:gap-1">
        <div className="font-display text-lg font-bold px-2 md:mb-6 mr-auto md:mr-0">
          POV<span className="text-primary">reel</span>
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
        <button
          onClick={() => supabase.auth.signOut()}
          className="md:mt-auto flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </aside>
      <main className="p-6 lg:p-10 max-w-6xl w-full">
        <Outlet />
      </main>
    </div>
  );
}
