import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Cloud, Download, Save, ExternalLink, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { saveCloudWorker, resetCloudWorker } from "@/lib/cloud-clipper.functions";
import { DEFAULT_CLOUD_WORKER_URL } from "@/lib/cloud-clipper-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CloudWorkerSettings({ savedUrl }: { savedUrl: string | null }) {
  const save = useServerFn(saveCloudWorker), reset = useServerFn(resetCloudWorker), qc = useQueryClient();
  const [url, setUrl] = useState(""), [token, setToken] = useState(""), [busy, setBusy] = useState(false);
  return <section className="mt-10 border-t border-border pt-7 space-y-5">
    <h2 className="flex items-center gap-3 text-xl font-display font-bold"><Cloud className="h-5 w-5 text-primary" />Cloud Clipper Worker</h2>
    <p className="text-sm text-muted-foreground break-all">{savedUrl ? `Connected · ${savedUrl}` : `Using shared default worker · ${DEFAULT_CLOUD_WORKER_URL}`}</p>
    <p className="text-xs text-muted-foreground">Every account uses the shared worker unless it saves its own below.</p>
    <form className="space-y-4" onSubmit={async e => {
      e.preventDefault(); setBusy(true);
      try { await save({ data: { url, token } }); setToken(""); await qc.invalidateQueries({ queryKey: ["studio-settings"] }); toast.success("Cloud worker saved securely"); }
      catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't save worker"); }
      finally { setBusy(false); }
    }}>
      <label className="text-sm block">Worker URL<Input aria-label="Cloud worker URL" className="mt-2" type="url" placeholder="https://your-space.hf.space" required value={url} onChange={e => setUrl(e.target.value)} /></label>
      <label className="text-sm block">Secret token (optional)<Input aria-label="Cloud worker secret token" className="mt-2" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder="Same WORKER_TOKEN as your host" /></label>
      <p className="text-xs text-muted-foreground">Saving replaces the connection and token. An empty token connects without authentication. Use a token on a public worker.</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy}><Save className="h-4 w-4" />{busy ? "Saving…" : "Save worker"}</Button>
        {savedUrl && <Button type="button" variant="outline" disabled={busy} onClick={async () => {
          if (!confirm("Remove your saved worker and use the shared default worker?")) return;
          setBusy(true);
          try { await reset(); setUrl(""); setToken(""); await qc.invalidateQueries({ queryKey: ["studio-settings"] }); toast.success("Now using the shared default worker"); }
          catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't reset worker"); }
          finally { setBusy(false); }
        }}><RotateCcw className="h-4 w-4" />Reset to shared default</Button>}
      </div>
    </form>
    <article className="border border-border bg-card rounded-md p-5 space-y-3">
      <h3 className="font-display font-bold">Deploy Free Worker</h3>
      <p className="text-sm text-muted-foreground">The default download is Cutline’s own worker, not OpenShorts. It downloads YouTube videos, transcribes with free Whisper, and makes center-cropped vertical clips with karaoke captions.</p>
      <ol className="list-decimal pl-5 text-sm space-y-2">
        <li>Create a Docker / Blank Space and upload app.py, openshorts_adapter.py, Dockerfile, requirements.txt and README.md.</li>
        <li>Add WORKER_TOKEN in your host’s secret settings; save the same token above.</li>
        <li>Wait for the host to start, then save its direct HTTPS address here.</li>
      </ol>
      <div className="flex flex-wrap gap-2">{["app.py", "openshorts_adapter.py", "Dockerfile", "Dockerfile.openshorts", "requirements.txt", "README.md"].map(file => <Button key={file} asChild size="sm" variant="outline"><a href={`/cloud-clipper/${file}`} download><Download className="h-4 w-4" />{file}</a></Button>)}
        <Button asChild size="sm" variant="outline"><a href="https://huggingface.co/new-space" target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />Create Space</a></Button>
      </div>
      <p className="text-xs text-muted-foreground">Free hosts can sleep and YouTube can block downloads. Setup and processing may take longer than two minutes. Your AI provider may charge. Other endpoints must implement the included Cutline protocol.</p>
      <h3 className="font-display font-bold">Optional OpenShorts adapter</h3>
      <p className="text-sm text-muted-foreground">Use Dockerfile.openshorts with the pinned full OpenShorts backend image described in README.md. This adapter reuses its downloader, transcription and vertical reframing; your saved AI still selects and reviews up to 15 moments. OpenShorts’ native API cannot be entered here directly.</p>
      <p className="text-xs text-muted-foreground">OpenShorts requires its full dependencies, model downloads and adequate memory; free Spaces compatibility is not verified. Its AI Shorts, Remotion templates, dubbing and publishing are not included. Clips await your approval before next-day Instagram or Facebook scheduling; YouTube scheduling remains in each clip’s editor.</p>
      <Button asChild size="sm" variant="outline"><a href="https://github.com/mutonby/openshorts" target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />OpenShorts repository</a></Button>
    </article>
  </section>;
}