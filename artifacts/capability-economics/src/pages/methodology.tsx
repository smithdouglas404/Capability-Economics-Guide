import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BookOpen, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const API_BASE = "/api";

type MethResponse = { methodology: string; version: string };

export default function MethodologyPage() {
  const [data, setData] = useState<MethResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/cei/methodology`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  function renderText(text: string) {
    const blocks: React.ReactNode[] = [];
    const paragraphs = text.split(/\n\n+/);
    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i].trim();
      if (!p) continue;
      const headingMatch = p.match(/^(#+)\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const text = headingMatch[2];
        if (level === 1) blocks.push(<h2 key={i} className="font-serif text-2xl mt-6 mb-2">{text}</h2>);
        else if (level === 2) blocks.push(<h3 key={i} className="font-serif text-xl mt-5 mb-2">{text}</h3>);
        else blocks.push(<h4 key={i} className="font-serif text-lg mt-4 mb-1">{text}</h4>);
        continue;
      }
      if (/^[-*]\s/m.test(p) || /^\d+\.\s/m.test(p)) {
        const items = p.split(/\n/).filter(Boolean);
        blocks.push(
          <ul key={i} className="list-disc pl-6 space-y-1 mb-3 text-sm">
            {items.map((it, j) => <li key={j}>{it.replace(/^[-*\d.]+\s+/, "")}</li>)}
          </ul>
        );
        continue;
      }
      if (/[=≈]|\bP\(/.test(p) && p.length < 200) {
        blocks.push(<pre key={i} className="bg-muted/40 rounded p-3 text-xs font-mono whitespace-pre-wrap mb-3">{p}</pre>);
        continue;
      }
      blocks.push(<p key={i} className="text-sm leading-relaxed mb-3">{p}</p>);
    }
    return blocks;
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-4xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Academic · Methodology</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <BookOpen className="w-8 h-8 text-primary" />
          CEI Methodology
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          The full computation behind the Capability Economics Index — Bayesian triangulation, velocity EMA,
          and how multi-source evidence is combined.
        </p>
      </motion.div>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg">CEI Methodology {data?.version ? `v${data.version}` : ""}</CardTitle>
          <CardDescription>Source of truth for how every score in this product is computed.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground"><Loader2 className="w-3.5 h-3.5 inline mr-1 animate-spin" />Loading…</p>
          ) : !data?.methodology ? (
            <p className="text-sm text-muted-foreground">Methodology unavailable.</p>
          ) : (
            <div>{renderText(data.methodology)}</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
