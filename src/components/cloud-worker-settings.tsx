import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Cloud, Download, Save, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { saveCloudWorker } from "@/lib/cloud-clipper.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CloudWorkerSettings({ savedUrl }: { savedUrl: string | null }) {
  const save = useServerFn(saveCloudWorker), qc = useQueryClient();
  const [url, setUrl] = useState(""), [token, setToken] = useState(""), [busy, setBusy] = useState(false);
  return <section className="mt-10 border-t border-border pt-7 space-y-5">
    <h2 className="flex items-center gap-3 text-xl font-display font-bold"><Cloud className="h-5 w-5 text-primary" />Cloud Clipper Worker</h2>
    {savedUrl && <p className="text-sm text-muted-foreground break-all">Connected · {savedUrl}</p>}
    <form className="space-y-4" onSubmit={async e => {
      e.preventDefault(); setBusy(true);
      try { await save({ data: { url, token } }); setToken(""); await qc.invalidateQueries({ queryKey: ["studio-settings"] }); toast.success("Cloud worker saved securely"); }
      catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't save worker"); }
      finally { setBusy(false); }
    }}>
      <label className="text-sm block">Worker URL<Input aria-label="Cloud worker URL" className="mt-2" type="url" placeholder="https://your-space.hf.space" required value={url} onChange={e => setUrl(e.target.value)} /></label>
      <label className="text-sm block">Secret token (optional)<Input aria-label="Cloud worker secret token" className="mt-2" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder="Same WORKER_TOKEN as your host" /></label>
      <p className="text-xs text-muted-foreground">Saving replaces the connection and token. An empty token connects without authentication. Use a token on a public worker.</p>
      <Button disabled={busy}><Save className="h-4 w-4" />{busy ? "Saving…" : "Save worker"}</Button>
    </form>
    <article className="border border-border bg-card rounded-md p-5 space-y-3">
      <h3 className="font-display font-bold">Deploy Free Worker</h3>
      <p className="text-sm text-muted-foreground">Self-host on Hugging Face’s free CPU tier or a Docker host. YouTube download, free Whisper transcription, FFmpeg vertical cuts and karaoke captions are included.</p>
      <ol className="list-decimal pl-5 text-sm space-y-2">
        <li>Create a Docker / Blank Space and upload the four files below.</li>
        <li>Add WORKER_TOKEN in your host’s secret settings; save the same token above.</li>
        <li>Wait for the host to start, then save its direct HTTPS address here.</li>
      </ol>
      <div className="flex flex-wrap gap-2">{["app.py", "Dockerfile", "requirements.txt", "README.md"].map(file => <Button key={file} asChild size="sm" variant="outline"><a href={`/cloud-clipper/${file}`} download><Download className="h-4 w-4" />{file}</a></Button>)}
        <Button asChild size="sm" variant="outline"><a href="https://huggingface.co/new-space" target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />Create Space</a></Button>
      </div>
      <p className="text-xs text-muted-foreground">Free hosts can sleep and YouTube can block downloads. Setup and processing may take longer than two minutes. Your AI provider may charge. Other endpoints must implement the included Cutline protocol.</p>
    </article>
  </section>;
}