import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Download, Eye, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const API_BASE = "/api";

type DatasetSlug = "cei_components" | "capabilities" | "companies" | "data_sources";
type Format = "csv" | "json" | "xlsx";
type Industry = { id: number; name: string };

const DATASET_LABELS: Record<DatasetSlug, string> = {
  cei_components: "CEI Components",
  capabilities: "Capabilities",
  companies: "Companies + Scores",
  data_sources: "Data Sources",
};

const XLSX_VIEW: Record<DatasetSlug, string | null> = {
  cei_components: "cei-components",
  capabilities: null,
  companies: null,
  data_sources: null,
};

export default function ExportPage() {
  const [dataset, setDataset] = useState<DatasetSlug>("cei_components");
  const [format, setFormat] = useState<Format>("csv");
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [industryId, setIndustryId] = useState<string>("");
  const [since, setSince] = useState<string>("");
  const [preview, setPreview] = useState<{ columns: string[]; rows: Record<string, unknown>[]; rowCount: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/industries`).then(r => r.json()).then(d => setIndustries(d.industries ?? d ?? []));
  }, []);

  function buildUrl(): string {
    if (format === "xlsx") {
      const v = XLSX_VIEW[dataset];
      if (!v) return "";
      const params = new URLSearchParams({ view: v });
      if (industryId) params.set("industryId", industryId);
      return `${API_BASE}/export/xlsx?${params.toString()}`;
    }
    const params = new URLSearchParams({ dataset });
    if (industryId) params.set("industryId", industryId);
    if (since && dataset === "cei_components") params.set("since", new Date(since).toISOString());
    return `${API_BASE}/export/${format}?${params.toString()}`;
  }

  async function loadPreview() {
    setPreviewing(true);
    setPreview(null);
    const params = new URLSearchParams({ dataset });
    if (industryId) params.set("industryId", industryId);
    if (since && dataset === "cei_components") params.set("since", new Date(since).toISOString());
    try {
      const res = await fetch(`${API_BASE}/export/json?${params.toString()}`, { credentials: "include" });
      const json = await res.json();
      setPreview({
        columns: json.columns ?? [],
        rows: (json.rows ?? []).slice(0, 10),
        rowCount: json.rowCount ?? json.rows?.length ?? 0,
      });
    } catch {
      setPreview({ columns: [], rows: [], rowCount: 0 });
    }
    setPreviewing(false);
  }

  function download() {
    const url = buildUrl();
    if (url) window.location.href = url;
  }

  const canXlsx = XLSX_VIEW[dataset] !== null;
  const canSince = dataset === "cei_components";

  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Researcher · Data</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <Download className="w-8 h-8 text-primary" />
          Bulk Export
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Pick a dataset, format, and optional filters. Preview the first 10 rows before downloading.
        </p>
      </motion.div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">Configure</CardTitle>
            <CardDescription>The dataset, format, and filters that shape your export.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Dataset</Label>
              <Select value={dataset} onValueChange={(v) => { setDataset(v as DatasetSlug); setPreview(null); if (v !== "cei_components" && format === "xlsx" && !XLSX_VIEW[v as DatasetSlug]) setFormat("csv"); }}>
                <SelectTrigger data-testid="dataset-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(DATASET_LABELS) as DatasetSlug[]).map((s) => (
                    <SelectItem key={s} value={s}>{DATASET_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Format</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as Format)}>
                <SelectTrigger data-testid="format-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                  {canXlsx && <SelectItem value="xlsx">XLSX</SelectItem>}
                </SelectContent>
              </Select>
              {!canXlsx && format === "xlsx" && (
                <p className="text-xs text-muted-foreground mt-1">XLSX not available for this dataset — switch to CSV or JSON.</p>
              )}
            </div>

            <div>
              <Label>Industry (optional)</Label>
              <Select value={industryId || "all"} onValueChange={(v) => setIndustryId(v === "all" ? "" : v)}>
                <SelectTrigger data-testid="industry-select"><SelectValue placeholder="All industries" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All industries</SelectItem>
                  {industries.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {canSince && (
              <div>
                <Label htmlFor="since-input">Since (optional, CEI components only)</Label>
                <Input id="since-input" type="date" value={since} onChange={(e) => setSince(e.target.value)} />
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button onClick={loadPreview} variant="outline" disabled={previewing} data-testid="preview-btn">
                {previewing ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Loading…</> : <><Eye className="w-3.5 h-3.5 mr-1" />Preview</>}
              </Button>
              <Button onClick={download} disabled={!buildUrl()} data-testid="download-btn">
                <Download className="w-3.5 h-3.5 mr-1" />Download
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">Request</CardTitle>
            <CardDescription>What will hit the server when you click Download.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="text-xs font-mono bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap break-all">
              <span className="text-emerald-600">GET</span> {buildUrl() || "—"}
            </pre>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">dataset={dataset}</Badge>
              <Badge variant="outline">format={format}</Badge>
              {industryId && <Badge variant="outline">industryId={industryId}</Badge>}
              {since && canSince && <Badge variant="outline">since={since}</Badge>}
            </div>
          </CardContent>
        </Card>
      </div>

      {preview && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="font-serif text-lg flex items-center justify-between">
              <span>Preview</span>
              <Badge variant="secondary" className="font-mono">{preview.rowCount.toLocaleString()} total · showing {preview.rows.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {preview.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground p-6 text-center">No rows match.</p>
            ) : (
              <table className="w-full text-xs" data-testid="preview-table">
                <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>{preview.columns.map((c) => <th key={c} className="text-left px-3 py-2 font-medium">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr key={i} className="border-t hover:bg-muted/30">
                      {preview.columns.map((c) => {
                        const v = row[c];
                        const display = v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);
                        return <td key={c} className="px-3 py-2 font-mono whitespace-nowrap max-w-[260px] truncate" title={display}>{display}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
