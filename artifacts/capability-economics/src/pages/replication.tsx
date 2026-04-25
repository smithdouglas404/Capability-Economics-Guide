import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { FileCode2, Download, Loader2, Package, BookOpen, Database, Code2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const API_BASE = "/api";

type Industry = { id: number; name: string };
type Capability = { id: number; name: string; industryId: number };

export default function ReplicationPage() {
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [industryId, setIndustryId] = useState<string>("");
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [selectedCapIds, setSelectedCapIds] = useState<Set<number>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/industries`).then(r => r.json()).then(d => setIndustries(d.industries ?? d ?? []));
  }, []);

  useEffect(() => {
    if (!industryId) { setCapabilities([]); setSelectedCapIds(new Set()); return; }
    fetch(`${API_BASE}/capabilities?industryId=${industryId}`, { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        const caps: Capability[] = (d.capabilities ?? d ?? []).map((c: { id: number; name: string; industryId: number }) => ({ id: c.id, name: c.name, industryId: c.industryId }));
        setCapabilities(caps);
        setSelectedCapIds(new Set());
      })
      .catch(() => setCapabilities([]));
  }, [industryId]);

  function toggleCap(id: number) {
    setSelectedCapIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function generate() {
    if (!industryId) return;
    setGenerating(true);
    setLastError(null);
    try {
      const body: { industryId: number; capabilityIds?: number[] } = { industryId: Number(industryId) };
      if (selectedCapIds.size > 0) body.capabilityIds = Array.from(selectedCapIds);
      const res = await fetch(`${API_BASE}/replication/bundle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Bundle generation failed" }));
        setLastError(err.error ?? "Bundle generation failed");
        setGenerating(false);
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(cd);
      const filename = match?.[1] ?? `replication-bundle-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setLastError((err as Error).message);
    }
    setGenerating(false);
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Researcher · API</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <FileCode2 className="w-8 h-8 text-primary" />
          Replication Bundle
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          A reproducible JSON bundle: dataset slice, methodology text, and a pandas code stub. Drop the file
          next to the stub and rerun every figure in the paper.
        </p>
      </motion.div>

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card><CardContent className="pt-6"><Database className="w-5 h-5 text-primary mb-2" /><div className="text-sm font-medium">Dataset</div><div className="text-xs text-muted-foreground">Capabilities, CEI components, source triangulations, citations.</div></CardContent></Card>
        <Card><CardContent className="pt-6"><BookOpen className="w-5 h-5 text-primary mb-2" /><div className="text-sm font-medium">Methodology</div><div className="text-xs text-muted-foreground">Bayesian posterior, prior derivation, velocity EMA. Versioned.</div></CardContent></Card>
        <Card><CardContent className="pt-6"><Code2 className="w-5 h-5 text-primary mb-2" /><div className="text-sm font-medium">Code stub</div><div className="text-xs text-muted-foreground">pandas script that loads the JSON and reproduces aggregates + velocity.</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg">Configure bundle</CardTitle>
          <CardDescription>Pick an industry. Optionally narrow to specific capabilities — leave empty for all.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Industry</Label>
            <Select value={industryId} onValueChange={setIndustryId}>
              <SelectTrigger data-testid="industry-select"><SelectValue placeholder="Pick an industry…" /></SelectTrigger>
              <SelectContent>
                {industries.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {industryId && (
            <div>
              <Label>Capabilities (optional — leave none selected for all)</Label>
              <div className="border rounded-md max-h-[300px] overflow-y-auto p-2 space-y-1">
                {capabilities.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-3 text-center">No capabilities found.</p>
                ) : capabilities.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-muted cursor-pointer">
                    <input
                      type="checkbox"
                      data-testid={`cap-${c.id}`}
                      checked={selectedCapIds.has(c.id)}
                      onChange={() => toggleCap(c.id)}
                      className="accent-primary"
                    />
                    <span>{c.name}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedCapIds.size === 0 ? `All ${capabilities.length} capabilities will be included.` : `${selectedCapIds.size} of ${capabilities.length} selected.`}
              </p>
            </div>
          )}

          {lastError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {lastError}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
              <Badge variant="outline">JSON</Badge>
              <Badge variant="outline">methodology v1.0</Badge>
              <Badge variant="outline">pandas stub</Badge>
            </div>
            <Button onClick={generate} disabled={!industryId || generating} data-testid="generate-btn">
              {generating ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Generating…</> : <><Download className="w-3.5 h-3.5 mr-1" />Generate bundle</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6 bg-muted/30">
        <CardContent className="pt-6 flex items-start gap-3">
          <Package className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            The bundle is plain JSON — load it in any language. The included Python stub is a starting point;
            schema is documented in the bundle's <code className="font-mono text-xs">readme</code> field.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
