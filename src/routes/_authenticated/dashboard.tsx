import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { addProduct, generateScript } from "@/lib/ugc.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Products — POVreel" },
      { name: "description", content: "Add Amazon and Flipkart products and generate POV review scripts." },
      { property: "og:title", content: "Products — POVreel" },
      { property: "og:description", content: "Add Amazon and Flipkart products and generate POV review scripts." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const add = useServerFn(addProduct);
  const gen = useServerFn(generateScript);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [genId, setGenId] = useState<string | null>(null);

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*, reviews(id, status, hook, created_at)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    try {
      await add({ data: { url } });
      setUrl("");
      toast.success("Product added and researched");
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add product");
    } finally {
      setAdding(false);
    }
  }

  async function onGen(productId: string) {
    setGenId(productId);
    try {
      const r = await gen({ data: { productId } });
      navigate({ to: "/reviews/$id", params: { id: r.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't write the script");
    } finally {
      setGenId(null);
    }
  }

  async function onDelete(id: string) {
    await supabase.from("products").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["products"] });
  }

  return (
    <div>
      <h1 className="font-display text-4xl font-bold">Products</h1>
      <p className="text-muted-foreground mt-1">Paste an Amazon or Flipkart link. We read the listing and research how people actually use it.</p>

      <form onSubmit={onAdd} className="mt-6 flex gap-2">
        <Input placeholder="https://www.amazon.in/dp/…  or  https://www.flipkart.com/…" value={url} onChange={(e) => setUrl(e.target.value)} required type="url" />
        <Button disabled={adding} className="shrink-0">
          {adding ? <><Loader2 className="h-4 w-4 animate-spin" /> Researching…</> : "Add product"}
        </Button>
      </form>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {products.length === 0 && <p className="text-muted-foreground">No products yet.</p>}
        {products.map((p) => (
          <article key={p.id} className="rounded-xl border border-border bg-card p-4 flex gap-4">
            {p.image_url ? (
              <img src={p.image_url} alt={p.title} className="h-24 w-24 rounded-md object-contain bg-secondary shrink-0" />
            ) : (
              <div className="h-24 w-24 rounded-md bg-secondary shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="capitalize">{p.source}</Badge>
                {p.price && <span className="text-sm text-primary">{p.price}</span>}
                <button onClick={() => onDelete(p.id)} className="ml-auto text-muted-foreground hover:text-destructive" aria-label="Delete product">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <h3 className="mt-1 font-medium line-clamp-2">{p.title}</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => onGen(p.id)} disabled={genId === p.id}>
                  {genId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {genId === p.id ? "Writing…" : "New script"}
                </Button>
                {p.reviews.map((r, i) => (
                  <Link key={r.id} to="/reviews/$id" params={{ id: r.id }}>
                    <Badge variant="outline">Review {i + 1} · {r.status}</Badge>
                  </Link>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
