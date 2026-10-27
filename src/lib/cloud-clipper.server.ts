import { workerUrl } from "./cloud-clipper-rules";

/** Only a saved public HTTPS origin is called; redirects never receive tokens. */
export async function callWorker(base: string, token: string, path: string, body?: unknown) {
  const response = await fetch(`${workerUrl(base)}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? null : JSON.stringify(body),
    redirect: "error", signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Cloud worker request failed (${response.status}). Check its URL, token and availability.`);
  return response.json() as Promise<unknown>;
}