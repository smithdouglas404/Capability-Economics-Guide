import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { FileText, Loader2, Copy, Check, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const API_BASE = "/api";

type Industry = { id: number; name: string };
type Capability = { id: number; name: string; industryId: number };

function renderMarkdown(md: string): React.ReactNode {
  const lines = md.split("\n");
  const out: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { out.push(<div key={i} className="h-3" />); continue; }
    if (line.startsWith("## ")) {
      out.push(<h2 key={i} className="font-serif text-2xl tracking-tight mt-2 mb-3">{line.slice(3)}</h2>);
      continue;
    }
    const parts: React.ReactNode[] = [];
    const re = /\*\*([^*]+)\*\*/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let key = 0;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) parts.push(line.slice(last, m.index));
      parts.push(<strong key={`${i}-${key++}`} className="font-semibold text-primary">{m[1]}</strong>);
      last = m.index + m[0].length;
    }
    if (last < line.length) parts.push(line.slice(last));
    out.push(<p key={i} className="text-sm leading-relaxed mb-2">{parts}</p>);
  }
  return out;
}

export default function PitchSnippets() {
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [industryId, setIndustryId] = useState<string>("");
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [capId, setCapId] = useState<string>("");
  const [snippet, setSnippet] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/industries`)
      .then((r) => r.json())
      .then((d) => {
        const list: Industry[] = d.industries ?? d ?? [];
        setIndustries(list);
        if (list.length && !industryId) setIndustryId(String(list[0].id));
      });
  }, []);

  useEffect(() => {
    if (!industryId) return;
    fetch(`${API_BASE}/capabilities?industryId=${industryId}`)
      .then((r) => r.json())
      .then((d) => {
        const list: Capability[] = Array.isArray(d) ? d : (d.capabilities ?? []);
        setCapabilities(list);
        setCapId("");
        setSnippet(null);
        setSource(null);
      });
  }, [industryId]);

  const selectedCap = useMemo(() => capabilities.find((c) => c.id === Number(capId)) ?? null, [capabilities, capId]);

  const generate = async () => {
    if (!capId) return;
    setGenerating(true);
    setError(null);
    setSnippet(null);
    setSource(null);
    try {
      const res = await fetch(`${API_BASE}/pitch-snippets/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capabilityId: Number(capId) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSnippet(data.snippet ?? null);
      setSource(data.source ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setGenerating(false);
  };

  const copy = async () => {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Plan · Pitch Snippets</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <FileText className="w-8 h-8 text-primary" />
          Pitch Snippets
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Pick a capability, generate a ~200-word investor pitch — problem, market, why this capability, why now.
          Copy it straight into your deck.
        </p>
      </motion.div>

      <Card className="mb-6">
        <CardContent className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">Industry</p>
            <Select value={industryId} onValueChange={setIndustryId}>
              <SelectTrigger><SelectValue placeholder="Industry" /></SelectTrigger>
              <SelectContent>
                {industries.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">Capability</p>
            <Select value={capId} onValueChange={setCapId}>
              <SelectTrigger><SelectValue placeholder={capabilities.length ? "Pick a capability" : "Pick an industry first"} /></SelectTrigger>
              <SelectContent>
                {capabilities.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Button onClick={generate} disabled={!capId || generating} className="w-full">
              {generating ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Generating…</> : <><Sparkles className="w-3.5 h-3.5 mr-1.5" />Generate pitch</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="mb-6 border-rose-500/40">
          <CardContent className="p-4 text-sm text-rose-700">Failed to generate: {error}</CardContent>
        </Card>
      )}

      {!snippet && !generating ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="font-serif text-lg mb-1">{selectedCap ? "Hit generate." : "Pick a capability first."}</p>
            <p className="text-sm">A pitch tailored to the capability's market, velocity, and saturation.</p>
          </CardContent>
        </Card>
      ) : generating ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Loader2 className="w-8 h-8 mx-auto mb-4 animate-spin opacity-50" />
            <p className="text-sm">Drafting your pitch…</p>
          </CardContent>
        </Card>
      ) : snippet ? (
        <Card>
          <CardContent className="p-7">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                {source === "ai" && <Badge variant="outline" className="bg-primary/10 text-primary border-primary/40"><Sparkles className="w-3 h-3 mr-1" />AI-drafted</Badge>}
                {source === "template" && <Badge variant="outline">Template</Badge>}
                {selectedCap && <span className="text-sm text-muted-foreground">for {selectedCap.name}</span>}
              </div>
              <Button size="sm" variant="outline" onClick={copy}>
                {copied ? <><Check className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />Copied</> : <><Copy className="w-3.5 h-3.5 mr-1.5" />Copy markdown</>}
              </Button>
            </div>
            <div className="prose prose-sm max-w-none">{renderMarkdown(snippet)}</div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
