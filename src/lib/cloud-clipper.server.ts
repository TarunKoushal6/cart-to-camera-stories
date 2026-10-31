import { workerUrl, workerHealthSchema, DEFAULT_CLOUD_WORKER_URL } from "./cloud-clipper-rules";

export async function checkWorker(base: string, token: string) {
  const parsed = workerHealthSchema.safeParse(await callWorker(base, token, "/health"));
  if (!parsed.success) throw new Error("This endpoint is not a Cutline v1 worker. OpenShorts needs the included adapter, not its /api/process URL.");
  return parsed.data;
}

/** A user's saved worker wins; otherwise every account uses the shared default worker. */
export async function resolveWorker(saved: { base_url: string | null; encrypted_key: string } | undefined, secret: string) {
  if (saved?.base_url) {
    const { decrypt } = await import("./studio-crypto.server");
    return { url: saved.base_url, token: await decrypt(saved.encrypted_key, secret) };
  }
  return { url: DEFAULT_CLOUD_WORKER_URL, token: process.env["CLOUD_WORKER_TOKEN"] || "" };
}

/** Only a saved public HTTPS origin is called; redirects are refused so tokens never follow them. */
export async function callWorker(base: string, token: string, path: string, body?: unknown) {
  const response = await fetch(`${workerUrl(base)}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? null : JSON.stringify(body),
    redirect: "manual", signal: AbortSignal.timeout(20000),
  });
  if (response.status >= 300 && response.status < 400) throw new Error("Cloud worker tried to redirect. Save its final direct HTTPS address.");
  if (!response.ok) throw new Error(`Cloud worker request failed (${response.status}). Check its URL, token and availability.`);
  return response.json() as Promise<unknown>;
}
