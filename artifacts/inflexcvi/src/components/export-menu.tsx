/**
 * ExportMenu — dropdown for downloading the current page's data as
 * Notion-flavored Markdown / CSV (with optional AI narrative wrapper).
 *
 * Pages opt in by passing a `buildExport()` callback that returns the
 * data + metadata the menu needs. Keeps the per-page wiring trivial:
 * pages don't import the export library directly.
 *
 * PDF is intentionally deferred — needs layout templating that isn't
 * worth doing per page; Markdown opens cleanly in Notion / Slack /
 * GitHub and CSV opens in Excel / Google Sheets / R / pandas, which
 * covers the PE / VC / F500 / professor / student artifact paths
 * called out in memory/strategic_ux_overhaul.md.
 */
import { useState } from "react";
import { Download, FileText, Sheet, Sparkles, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  toCSV,
  toMarkdown,
  downloadFile,
  fetchExportNarrative,
  type ExportRow,
  type MarkdownDocument,
} from "@/lib/exports";
import { usePersona } from "@/lib/persona";

export interface ExportPayload {
  /** Filename stem (no extension). e.g. "companies-banking-2026-05-19". */
  filename: string;
  /** Document for Markdown export — title, sections, sources. */
  markdown: MarkdownDocument;
  /** Flat row array for CSV export. Same data, different shape. */
  csv: ExportRow[];
  /** Short prose for the AI narrative wrapper's "what is the user exporting" context. */
  exportSummary: string;
}

export interface ExportMenuProps {
  /** Called lazily when the user picks an export option — keeps work cheap on idle. */
  buildExport: () => ExportPayload | Promise<ExportPayload>;
  /** Optional override for the trigger button label. Defaults to "Export". */
  buttonLabel?: string;
  /** Disable when the page is still loading data. */
  disabled?: boolean;
}

type LoadingKind = "md-ai" | "md" | "csv" | null;

export function ExportMenu({ buildExport, buttonLabel = "Export", disabled = false }: ExportMenuProps) {
  const [loading, setLoading] = useState<LoadingKind>(null);
  const { persona } = usePersona();

  const handleCsv = async (): Promise<void> => {
    setLoading("csv");
    try {
      const payload = await buildExport();
      const csv = toCSV(payload.csv);
      downloadFile(`${payload.filename}.csv`, csv, "text/csv;charset=utf-8");
    } finally {
      setLoading(null);
    }
  };

  const handleMarkdown = async (withNarrative: boolean): Promise<void> => {
    setLoading(withNarrative ? "md-ai" : "md");
    try {
      const payload = await buildExport();
      let doc = payload.markdown;
      if (withNarrative) {
        const narrative = await fetchExportNarrative({
          pageTitle: doc.title,
          summary: payload.exportSummary,
          persona,
          dataSample: payload.csv.slice(0, 25),
        });
        if (narrative) doc = { ...doc, narrative };
      }
      const md = toMarkdown(doc);
      downloadFile(`${payload.filename}.md`, md, "text/markdown;charset=utf-8");
    } finally {
      setLoading(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled || loading !== null}>
          {loading !== null ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
          {buttonLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Take this with you</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => handleMarkdown(true)}
          disabled={loading !== null}
          className="flex items-start gap-2 cursor-pointer"
        >
          <Sparkles className="w-4 h-4 mt-0.5 text-accent" />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm">Notion / Markdown + AI narrative</div>
            <div className="text-[11px] text-muted-foreground leading-snug">
              Adds a persona-aware lead paragraph before the data. Paste straight into Notion / Slack / Obsidian.
            </div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleMarkdown(false)}
          disabled={loading !== null}
          className="flex items-start gap-2 cursor-pointer"
        >
          <FileText className="w-4 h-4 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm">Notion / Markdown (no narrative)</div>
            <div className="text-[11px] text-muted-foreground leading-snug">
              Raw structured export. No LLM call.
            </div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleCsv}
          disabled={loading !== null}
          className="flex items-start gap-2 cursor-pointer"
        >
          <Sheet className="w-4 h-4 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm">CSV (Excel / Sheets / pandas)</div>
            <div className="text-[11px] text-muted-foreground leading-snug">
              Raw data only. Useful for spreadsheets, R, or Python.
            </div>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
