import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { FileText, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const apiBase = import.meta.env.VITE_API_URL || "";

type Capability = { id: number; name: string; industryId: number };
type ThesisResp = { capabilityId: number; capabilityName: string; industryName: string; generatedAt: string; memoMarkdown: string; inputs: any };

export default function Thesis() {
  const [caps, setCaps] = useState<Capability[]>([]);
  const [capId, setCapId] = useState<string>("");
  const [memo, setMemo] = useState<ThesisResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiBase}/api/capabilities`).then(r => r.json()).then((d: Capability[]) => {
      setCaps(d);
      if (d[0]) setCapId(String(d[0].id));
    });
  }, []);

  async function generate() {
    if (!capId) return;
    setLoading(true); setErr(null); setMemo(null);
    try {
      const r = await fetch(`${apiBase}/api/alpha/thesis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capabilityId: parseInt(capId) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "thesis failed");
      setMemo(j);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Deal Flow · Thesis Memo</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <FileText className="w-8 h-8 text-primary" />
          Investment Thesis
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Auto-generated thesis memo per capability.
        </p>
      </motion.div>

      <div className="space-y-4">
        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[260px]">
              <div className="text-xs text-zinc-500 mb-1">Capability</div>
              <Select value={capId} onValueChange={setCapId}>
                <SelectTrigger><SelectValue placeholder="Pick capability" /></SelectTrigger>
                <SelectContent>{caps.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={generate} disabled={loading || !capId}>{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}Generate Memo</Button>
          </CardContent>
        </Card>
        {err && <div className="text-sm text-red-600 px-2">{err}</div>}
        {loading && <Card><CardContent className="p-8 text-center text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />Composing thesis from EVaR + Cascade + Narrative + company data… (~30s)</CardContent></Card>}
        {memo && (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{memo.capabilityName}</CardTitle>
                  <div className="text-xs text-zinc-500 mt-1">{memo.industryName} • Generated {new Date(memo.generatedAt).toLocaleString()}</div>
                </div>
                <div className="text-xs text-zinc-500 text-right">
                  <div>{memo.inputs.upstream}↑ {memo.inputs.downstream}↓ deps</div>
                  <div>{memo.inputs.topCompanies?.length ?? 0} companies</div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <article className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-bold prose-h1:text-xl prose-h2:text-base prose-h2:mt-5 prose-h2:mb-2 prose-p:my-2 prose-li:my-0.5 leading-relaxed">
                <ReactMarkdown>{memo.memoMarkdown}</ReactMarkdown>
              </article>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
