import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { generateScript } from "@/lib/ugc.functions";
import type { ScriptLanguage, ScriptMode } from "@/lib/ugc-rules";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function ReviewCreator({ productId }: { productId: string }) {
  const navigate = useNavigate();
  const create = useServerFn(generateScript);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ScriptMode>("ai");
  const [language, setLanguage] = useState<ScriptLanguage>("english");
  const [voiceover1, setVoiceover1] = useState("");
  const [voiceover2, setVoiceover2] = useState("");
  const [scene1, setScene1] = useState("");
  const [scene2, setScene2] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await create({ data: { productId, mode, language, voiceover1, voiceover2, scene1, scene2 } });
      setOpen(false);
      await navigate({ to: "/reviews/$id", params: { id: result.id } });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't create review"); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
    <DialogTrigger asChild><Button size="sm"><Sparkles className="h-4 w-4" />New review</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>New product review</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2"><Label htmlFor={`mode-${productId}`}>Review mode</Label>
          <Select value={mode} onValueChange={(value) => setMode(value as ScriptMode)} disabled={busy}>
            <SelectTrigger id={`mode-${productId}`}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="ai">AI script</SelectItem><SelectItem value="custom">Paste custom script</SelectItem><SelectItem value="actions">No script / Actions only</SelectItem><SelectItem value="upload">Upload external video</SelectItem></SelectContent>
          </Select>
        </div>
        {mode !== "upload" && <div className="space-y-2"><Label htmlFor={`language-${productId}`}>Language</Label>
          <Select value={language} onValueChange={(value) => setLanguage(value as ScriptLanguage)} disabled={busy}>
            <SelectTrigger id={`language-${productId}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="english">English</SelectItem><SelectItem value="hindi_hinglish">Hindi / Hinglish</SelectItem></SelectContent>
          </Select>
        </div>}
        {mode === "custom" && <>
          <div className="space-y-2"><Label htmlFor="custom-vo1">Custom script — first 10 seconds</Label><Textarea id="custom-vo1" value={voiceover1} onChange={(e) => setVoiceover1(e.target.value)} maxLength={5000} required rows={4} /></div>
          <div className="space-y-2"><Label htmlFor="custom-vo2">Custom script — last 10 seconds (optional)</Label><Textarea id="custom-vo2" value={voiceover2} onChange={(e) => setVoiceover2(e.target.value)} maxLength={5000} rows={3} /></div>
          <div className="space-y-2"><Label htmlFor="custom-sc1">Shot 1 — visual directions and hand actions</Label><Textarea id="custom-sc1" value={scene1} onChange={(e) => setScene1(e.target.value)} maxLength={5000} required /></div>
          <div className="space-y-2"><Label htmlFor="custom-sc2">Shot 2 — visual directions and hand actions</Label><Textarea id="custom-sc2" value={scene2} onChange={(e) => setScene2(e.target.value)} maxLength={5000} required /></div>
        </>}
        <Button type="submit" disabled={busy} className="w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "upload" ? <Upload className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}{busy ? "Creating…" : mode === "custom" ? "Save custom script" : mode === "upload" ? "Continue to upload" : mode === "actions" ? "Generate action shots" : "Generate AI script"}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}