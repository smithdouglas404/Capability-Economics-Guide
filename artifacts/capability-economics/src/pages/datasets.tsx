import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Database, Download, FileSpreadsheet, FileJson, FileText, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const API_BASE = "/api";

type DatasetSlug = "cei_components" | "capabilities" | "companies" | "data_sources";

type DatasetMeta = {
  slug: DatasetSlug;
  name: string;
  description: string;
  formats: Array<"csv" | "json" | "xlsx">;
  xlsxView?: string;
};

const DATASETS: DatasetMeta[] = [
  {
    slug: "cei_components",
    name: "CEI Components",
    description: "Per-capability Bayesian posterior, confidence, velocity, and economic multiplier — the live snapshot powering the index.",
    formats: ["csv", "json", "xlsx"],
    xlsxView: "cei-components",
  },
  {
    slug: "capabilities",
    name: "Capabilities",
    description: "Full capability catalog: name, slug, parent, isLeaf, value-chain stage, benchmark score, source citations.",
    formats: ["csv", "json"],
  },
  {
    slug: "companies",
    name: "Companies + Scores",
    description: "Company catalog joined to composite, moat, AI disruptability, capability coverage, CEI weighted, forecasted value.",
    formats: ["csv", "json"],
  },
  {
    slug: "data_sources",
    name: "Data Sources",
    description: "Citation database — every URL, publisher, and accessed-at timestamp behind a consensus score.",
    formats: ["csv", "json"],
  },
];

type RowCounts = Partial<Record<DatasetSlug, number>>;

export default function DatasetsPage() {
  const [counts, setCounts] = useState<RowCounts>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadCounts() {
      const out: RowCounts = {};
      await Promise.all(
        DATASETS.map(async (d) => {
          try {
            const res = await fetch(`${API_BASE}/export/json?dataset=${d.slug}`, { credentials: "include" });
            if (!res.ok) return;
            const json = await res.json();
            out[d.slug] = json.rowCount ?? json.rows?.length ?? null;
          } catch {
            // leave undefined — UI shows "—"
          }
        }),
      );
      if (!cancelled) { setCounts(out); setLoading(false); }
    }
    void loadCounts();
    return () => { cancelled = true; };
  }, []);

  function downloadUrl(d: DatasetMeta, fmt: "csv" | "json" | "xlsx"): string {
    if (fmt === "xlsx") return `${API_BASE}/export/xlsx?view=${d.xlsxView}`;
    return `${API_BASE}/export/${fmt}?dataset=${d.slug}`;
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Researcher · Data</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <Database className="w-8 h-8 text-primary" />
          Datasets
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Raw tables behind the index. Every row is the same data the platform uses internally — download in CSV for spreadsheets,
          JSON for code, or XLSX for analysis with formatting preserved.
        </p>
      </motion.div>

      <div className="grid gap-4">
        {DATASETS.map((d) => {
          const count = counts[d.slug];
          return (
            <Card key={d.slug} data-testid={`dataset-${d.slug}`}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="font-serif text-xl flex items-center gap-2">
                      {d.name}
                      <Badge variant="outline" className="font-mono text-xs">{d.slug}</Badge>
                    </CardTitle>
                    <CardDescription className="mt-1 max-w-2xl">{d.description}</CardDescription>
                  </div>
                  <div className="text-right">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Rows</div>
                    <div className="font-mono text-lg">
                      {loading ? <Loader2 className="w-4 h-4 inline animate-spin" /> : count?.toLocaleString() ?? "—"}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {d.formats.includes("csv") && (
                    <Button asChild size="sm" variant="outline">
                      <a href={downloadUrl(d, "csv")} download data-testid={`download-${d.slug}-csv`}>
                        <FileText className="w-3.5 h-3.5 mr-1" />CSV
                      </a>
                    </Button>
                  )}
                  {d.formats.includes("json") && (
                    <Button asChild size="sm" variant="outline">
                      <a href={downloadUrl(d, "json")} download data-testid={`download-${d.slug}-json`}>
                        <FileJson className="w-3.5 h-3.5 mr-1" />JSON
                      </a>
                    </Button>
                  )}
                  {d.formats.includes("xlsx") && (
                    <Button asChild size="sm" variant="outline">
                      <a href={downloadUrl(d, "xlsx")} download data-testid={`download-${d.slug}-xlsx`}>
                        <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />XLSX
                      </a>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="mt-8 bg-muted/30">
        <CardContent className="pt-6 flex items-start gap-3">
          <Download className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            Need a slice — single industry, since a date, multiple datasets at once?
            Use the <a href="/export" className="underline hover:text-foreground">Bulk Export wizard</a> or
            generate a <a href="/replication" className="underline hover:text-foreground">replication bundle</a> with code stub.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
