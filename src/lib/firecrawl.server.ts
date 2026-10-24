const FC = "https://connector-gateway.lovable.dev/firecrawl/v2";

async function fc(path: string, body: unknown) {
  const lk = process.env["LOVABLE_API_KEY"];
  const fk = process.env["FIRECRAWL_API_KEY"];
  if (!lk || !fk) throw new Error("Web reading is not configured");
  const res = await fetch(`${FC}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": fk },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Firecrawl ${path} failed [${res.status}]: ${text}`);
    throw new Error(`Couldn't read the page (${res.status}).`);
  }
  return JSON.parse(text);
}

export type ScrapedProduct = { title: string; price: string | null; image_url: string | null; features: string };

export async function scrapeProduct(url: string): Promise<ScrapedProduct> {
  const r = await fc("/scrape", {
    url,
    onlyMainContent: true,
    formats: [
      {
        type: "json",
        prompt:
          "Extract the product title, current price with currency, the main product image URL, and a bullet list of key features/specs from this Amazon or Flipkart product page.",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            price: { type: "string" },
            image_url: { type: "string" },
            features: { type: "array", items: { type: "string" } },
          },
          required: ["title"],
        },
      },
    ],
  });
  const j = r.json ?? r.data?.json ?? {};
  const meta = r.metadata ?? r.data?.metadata ?? {};
  return {
    title: (j.title || meta.title || "Untitled product").slice(0, 300),
    price: j.price || null,
    image_url: j.image_url || meta.ogImage || null,
    features: Array.isArray(j.features) ? j.features.slice(0, 15).map((f: string) => `• ${f}`).join("\n") : "",
  };
}

export async function researchProduct(title: string): Promise<string> {
  try {
    const r = await fc("/search", { query: `${title} review how to use pros cons`, limit: 6 });
    const items: { title?: string; description?: string; url?: string }[] = r.data?.web ?? r.data ?? [];
    return items
      .slice(0, 6)
      .map((i) => `- ${i.title ?? ""}: ${i.description ?? ""} (${i.url ?? ""})`)
      .join("\n");
  } catch (e) {
    console.error(e);
    return "";
  }
}
