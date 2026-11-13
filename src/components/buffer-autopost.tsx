import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Plus, Save, Send, X, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { getBufferAutopost, saveBufferAutopost, saveBufferKey, postRandomNow } from "@/lib/buffer.functions";
import { RECOMMENDED_SLOTS } from "@/lib/buffer-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { wantsBuffer } from "@/lib/cloud-clipper-rules";

export function BufferAutopost() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setAllowed(wantsBuffer(data.user?.email))); }, []);
  return allowed ? <BufferAutopostCard /> : null;
}

function BufferAutopostCard() {
  const load = useServerFn(getBufferAutopost), save = useServerFn(saveBufferAutopost), saveKey = useServerFn(saveBufferKey), now = useServerFn(postRandomNow);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["buffer-autopost"], queryFn: () => load() });
  const [key, setKey] = useState(""), [busy, setBusy] = useState(false);
  const [slots, setSlots] = useState<string[]>(RECOMMENDED_SLOTS), [channels, setChannels] = useState<string[]>([]), [enabled, setEnabled] = useState(false), [consent, setConsent] = useState(false);
  const [tz, setTz] = useState("Asia/Kolkata");
  useEffect(() => { const s = q.data?.settings; if (s) { setSlots(s.slots.length ? s.slots : RECOMMENDED_SLOTS); setChannels(s.channelIds); setEnabled(s.enabled); setConsent(s.enabled); setTz(s.timezone); } }, [q.data]);
  const run = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); try { await fn(); toast.success(ok); await qc.invalidateQueries({ queryKey: ["buffer-autopost"] }); } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); } };
  const d = q.data;
  return <section className="mt-8 rounded-lg border border-border bg-card p-5 space-y-5">
    <div className="flex flex-wrap justify-between gap-2 items-center">
      <h2 className="flex items-center gap-2 font-display text-xl font-bold"><CalendarClock className="h-5 w-5 text-primary" />Buffer auto-post</h2>
      {d?.connected && <span className="text-xs text-muted-foreground">{d.remaining} reels waiting in the pool</span>}
    </div>
    {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : <>
      <form className="flex flex-wrap gap-2 items-end" onSubmit={e => { e.preventDefault(); run(async () => { await saveKey({ data: { key } }); setKey(""); }, "Buffer connected"); }}>
        <label className="text-sm flex-1 min-w-56">{d?.connected ? "Buffer connected · replace key" : "Buffer API key"}
          <Input aria-label="Buffer API key" className="mt-2" type="password" autoComplete="off" required value={key} onChange={e => setKey(e.target.value)} placeholder="Buffer → Settings → API" /></label>
        <Button disabled={busy || key.length < 10}><KeyRound className="h-4 w-4" />Save key</Button>
      </form>
      {d?.channelError && <p className="text-sm text-destructive">{d.channelError}</p>}
      {d?.connected && <>
        <div><p className="text-sm font-medium">Channels</p><div className="mt-2 flex flex-wrap gap-2">
          {d.channels.map(c => <label key={c.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm cursor-pointer">
            <input type="checkbox" checked={channels.includes(c.id)} onChange={e => setChannels(e.target.checked ? [...channels, c.id] : channels.filter(x => x !== c.id))} />
            <span className="capitalize">{c.service}</span><span className="text-muted-foreground">{c.name}</span></label>)}
          {!d.channels.length && <p className="text-sm text-muted-foreground">No channels in Buffer yet — connect Instagram/Facebook/YouTube inside Buffer.</p>}
        </div></div>
        <div><p className="text-sm font-medium">Daily post times <span className="text-muted-foreground font-normal">(one random reel per time · best: 2–3 a day)</span></p>
          <div className="mt-2 flex flex-wrap gap-2 items-center">
            {slots.map((s, i) => <span key={i} className="flex items-center gap-1"><Input aria-label={`Post time ${i + 1}`} type="time" className="w-32" value={s} onChange={e => setSlots(slots.map((x, j) => j === i ? e.target.value : x))} />
              <Button type="button" size="icon" variant="ghost" aria-label="Remove time" onClick={() => setSlots(slots.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button></span>)}
            {slots.length < 6 && <Button type="button" variant="outline" size="sm" onClick={() => setSlots([...slots, "09:00"])}><Plus className="h-4 w-4" />Add time</Button>}
          </div>
          <label className="text-xs text-muted-foreground mt-2 block">Time zone <Input aria-label="Time zone" className="mt-1 w-56" value={tz} onChange={e => setTz(e.target.value)} /></label>
        </div>
        <label className="flex gap-2 items-start text-sm"><input type="checkbox" className="mt-1" checked={consent} onChange={e => setConsent(e.target.checked)} />I approve: post a random unposted reel from my clips at these times, without asking each time.</label>
        <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={enabled} disabled={!consent} onChange={e => setEnabled(e.target.checked)} />Auto-post is ON</label>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => run(() => save({ data: { enabled: enabled && consent, slots, timezone: tz, channelIds: channels } }), "Schedule saved")}><Save className="h-4 w-4" />Save schedule</Button>
          <Button variant="outline" disabled={busy || !consent || !channels.length} onClick={() => run(async () => { await save({ data: { enabled: enabled && consent, slots, timezone: tz, channelIds: channels } }); const r = await now(); toast.message(r.result); }, "Sent to Buffer")}><Send className="h-4 w-4" />Post one random reel now</Button>
        </div>
        {d.settings?.lastResult && <p className="text-xs text-muted-foreground break-words">Last: {d.settings.lastResult}</p>}
        <p className="text-xs text-muted-foreground">Checked every 5 minutes, so a post can go out up to ~5 minutes after the set time. Each reel is posted only once.</p>
      </>}
    </>}
  </section>;
}
