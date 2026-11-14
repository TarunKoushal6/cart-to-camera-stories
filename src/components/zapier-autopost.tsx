import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Plus, Save, Send, X, Unplug, Link2 } from "lucide-react";
import { toast } from "sonner";
import { getZapierAutopost, saveZapierWebhook, saveZapierSchedule, sendRandomToZapier, disconnectZapier } from "@/lib/zapier.functions";
import { RECOMMENDED_SLOTS } from "@/lib/zapier-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";

export function ZapierAutopost() {
  const load = useServerFn(getZapierAutopost), saveUrl = useServerFn(saveZapierWebhook), saveSchedule = useServerFn(saveZapierSchedule), send = useServerFn(sendRandomToZapier), disconnect = useServerFn(disconnectZapier);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["zapier-autopost"], queryFn: () => load(), refetchInterval: 30000 });
  const [url, setUrl] = useState(""), [busy, setBusy] = useState(false), [slots, setSlots] = useState<string[]>(RECOMMENDED_SLOTS);
  const [timezone, setTimezone] = useState("Asia/Kolkata"), [enabled, setEnabled] = useState(false), [consent, setConsent] = useState(false), [lastResult, setLastResult] = useState("");
  useEffect(() => { const s = q.data?.settings; if (s) { setSlots(s.slots); setTimezone(s.timezone); setEnabled(s.enabled); setConsent(s.enabled); } }, [q.data?.settings?.updated_at]);
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    try { await action(); toast.success(message); await qc.invalidateQueries({ queryKey: ["zapier-autopost"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't update Zapier."); }
    finally { setBusy(false); }
  }
  if (q.error) return <p className="mt-8 text-sm text-destructive">Couldn't load automation settings.</p>;
  if (!q.data?.allowed) return null;
  const connected = q.data.connected;
  return <section className="mt-8 border-y border-border py-6 space-y-5" aria-label="Zapier automation">
    <div className="flex flex-wrap justify-between items-center gap-2">
      <h2 className="font-display text-xl font-bold flex items-center gap-2"><CalendarClock className="h-5 w-5 text-primary" />Zapier auto-post</h2>
      <span className="text-xs text-muted-foreground">{connected ? "Webhook saved" : "Not connected"}</span>
    </div>
    <form className="flex flex-wrap gap-2 items-end" onSubmit={e => { e.preventDefault(); void run(async () => { await saveUrl({ data: { url } }); setUrl(""); setConsent(false); setEnabled(false); }, "Zapier webhook saved"); }}>
      <label className="text-sm flex-1 min-w-0 basis-64">{connected ? "Replace Zapier webhook URL" : "Zapier webhook URL"}
        <Input aria-label="Zapier webhook URL" className="mt-2" type="password" autoComplete="off" required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://hooks.zapier.com/hooks/catch/…" />
      </label>
      <Button disabled={busy || !url.trim()}><Link2 className="h-4 w-4" />Save webhook</Button>
    </form>
    {connected && <>
      <div><p className="text-sm font-medium">Daily send times</p>
        <div className="mt-2 flex flex-wrap gap-2 items-center">
          {slots.map((s, i) => <div key={i} className="flex items-center gap-1"><Input aria-label={`Send time ${i + 1}`} type="time" className="w-32" value={s} onChange={e => setSlots(slots.map((x, j) => j === i ? e.target.value : x))} />
            <Button type="button" size="icon" variant="ghost" aria-label={`Remove time ${i + 1}`} title="Remove time" onClick={() => setSlots(slots.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button></div>)}
          {slots.length < 6 && <Button type="button" size="icon" variant="outline" aria-label="Add time" title="Add time" onClick={() => setSlots([...slots, "09:00"])}><Plus className="h-4 w-4" /></Button>}
        </div>
        <label className="text-sm block mt-3">Time zone<Input aria-label="Time zone" className="mt-2 max-w-64" value={timezone} onChange={e => setTimezone(e.target.value)} /></label>
      </div>
      <label className="flex gap-3 items-start text-sm"><Checkbox aria-label="Approve Zapier sends" checked={consent} onCheckedChange={v => { setConsent(v === true); if (v !== true) setEnabled(false); }} className="mt-0.5" /><span>I approve sending a random unsent reel from my saved clips to this Zap.</span></label>
      <label className="flex items-center gap-3 text-sm"><Switch aria-label="Automatic Zapier sends" checked={enabled} disabled={!consent || busy} onCheckedChange={setEnabled} />Automatic sends</label>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !slots.length} onClick={() => void run(() => saveSchedule({ data: { enabled, consent, slots, timezone } }), "Schedule saved")}><Save className="h-4 w-4" />Save schedule</Button>
        <Button variant="outline" disabled={busy || !consent} onClick={() => void run(async () => { const result = await send({ data: { consent } }); setLastResult(result.result); }, "Zapier send finished — check run history")}><Send className="h-4 w-4" />Send one random reel</Button>
        <Button variant="ghost" disabled={busy} onClick={() => { if (window.confirm("Disconnect Zapier and stop automatic sends?")) void run(() => disconnect(), "Zapier disconnected"); }}><Unplug className="h-4 w-4" />Disconnect</Button>
      </div>
      {(lastResult || q.data.settings?.last_result) && <p role="status" className="text-sm text-muted-foreground break-words">{lastResult || q.data.settings?.last_result}</p>}
    </>}
  </section>;
}