import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Columns3, Plus, Trash2, Download, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API_BASE = "/api";

type Industry = { id: number; name: string };
type CompanyOption = { id: number; name: string; industryId: number };
type FingerprintRow = {
  fp: { companyId: number; capabilityId: number; weight: number };
  cap: { id: number; name: string };
};
type CompanyDetail = {
  company: { id: number; name: string; industryId: number };
  fingerprint: FingerprintRow[];
};

function parseIdsFromUrl(): number[] {
  if (typeof window === "undefined") return [];
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("ids") ?? "";
  return raw.split(",").map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);
}

function weightCell(w: number | undefined): { text: string; cls: string } {
  if (w == null) return { text: "—", cls: "text-muted-foreground" };
  const pct = Math.round(w * 100);
  const cls = w >= 0.6 ? "text-emerald-600 font-medium"
    : w >= 0.3 ? "text-amber-600"
    : "text-muted-foreground";
  return { text: `${pct}%`, cls };
}

export default function Comparables() {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [details, setDetails] = useState<Map<number, CompanyDetail>>(new Map());
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [pickerIndustryId, setPickerIndustryId] = useState<number | null>(null);
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");

  useEffect(() => {
    const ids = parseIdsFromUrl();
    if (ids.length) setSelectedIds(ids);
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/industries`).then(r => r.json()).then((d) => {
      const list: Industry[] = d.industries ?? d ?? [];
      setIndustries(list);
      if (list[0]) setPickerIndustryId(list[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const missing = selectedIds.filter(id => !details.has(id));
    if (!missing.length) return;
    setLoading(true);
    Promise.all(missing.map(id =>
      fetch(`${API_BASE}/workbench/companies/${id}`, { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then((d: CompanyDetail | null) => ({ id, d }))
    )).then(results => {
      setDetails(prev => {
        const next = new Map(prev);
        for (const { id, d } of results) {
          if (d) next.set(id, d);
        }
        return next;
      });
      setLoading(false);
    });
  }, [selectedIds, details]);

  useEffect(() => {
    if (!pickerOpen || !pickerIndustryId) return;
    setOptionsLoading(true);
    fetch(`${API_BASE}/workbench/companies?industryId=${pickerIndustryId}&limit=200`, { credentials: "include" })
      .then(r => r.json())
      .then((data: { companies?: Array<{ company?: { id: number; name: string; industryId: number }; id?: number; name?: string; industryId?: number }> }) => {
        const items = (data.companies ?? []).map((row) => {
          const c = row.company ?? row;
          return { id: c.id!, name: c.name!, industryId: c.industryId! };
        });
        setCompanyOptions(items);
        setOptionsLoading(false);
      })
      .catch(() => { setOptionsLoading(false); });
  }, [pickerOpen, pickerIndustryId]);

  function addCompany(id: number) {
    if (selectedIds.includes(id)) { setPickerOpen(false); return; }
    setSelectedIds([...selectedIds, id]);
    setPickerOpen(false);
    setPickerQuery("");
  }

  function removeCompany(id: number) {
    setSelectedIds(selectedIds.filter(x => x !== id));
    setDetails(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }

  function exportXlsx() {
    if (selectedIds.length === 0) return;
    window.open(`${API_BASE}/export/xlsx?view=comparables&companyIds=${selectedIds.join(",")}`);
  }

  const orderedDetails = useMemo(() => {
    return selectedIds.map(id => details.get(id)).filter((d): d is CompanyDetail => !!d);
  }, [selectedIds, details]);

  const matrix = useMemo(() => {
    const capMap = new Map<number, string>();
    const weights = new Map<string, number>();
    for (const d of orderedDetails) {
      for (const row of d.fingerprint ?? []) {
        capMap.set(row.cap.id, row.cap.name);
        weights.set(`${d.company.id}:${row.cap.id}`, row.fp.weight);
      }
    }
    const capabilities = Array.from(capMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { capabilities, weights };
  }, [orderedDetails]);

  const filteredOptions = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return companyOptions
      .filter(o => !selectedIds.includes(o.id))
      .filter(o => !q || o.name.toLowerCase().includes(q))
      .slice(0, 50);
  }, [companyOptions, pickerQuery, selectedIds]);

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Deal Flow · Comparables</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <Columns3 className="w-8 h-8 text-primary" />
          Comparables
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Side-by-side capability fingerprint matrix for any set of companies. Pick targets, eyeball overlap, export to XLSX.
        </p>
      </motion.div>

      <Card className="mb-4">
        <CardContent className="p-4 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" />Add company
          </Button>
          <Button size="sm" variant="outline" onClick={exportXlsx} disabled={selectedIds.length === 0}>
            <Download className="w-3.5 h-3.5 mr-1" />Export XLSX
          </Button>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            {orderedDetails.map(d => (
              <Badge key={d.company.id} variant="secondary" className="gap-1">
                {d.company.name}
                <button onClick={() => removeCompany(d.company.id)} className="ml-1 hover:text-rose-600">
                  <Trash2 className="w-3 h-3" />
                </button>
              </Badge>
            ))}
            {selectedIds.length === 0 && (
              <span className="text-sm text-muted-foreground">No companies selected</span>
            )}
          </div>
        </CardContent>
      </Card>

      {selectedIds.length < 2 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Columns3 className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="font-serif text-lg mb-1">Pick at least two companies</p>
            <p className="text-sm">Add companies to see their capability fingerprints side-by-side.</p>
          </CardContent>
        </Card>
      ) : loading && orderedDetails.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Loading…</CardContent></Card>
      ) : orderedDetails.length < 2 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Columns3 className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="font-serif text-lg mb-1">Need at least two resolved companies</p>
            <p className="text-sm">{orderedDetails.length} of {selectedIds.length} selected loaded — others may have no fingerprint data.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Capability</th>
                  {orderedDetails.map(d => (
                    <th key={d.company.id} className="text-right px-3 py-3 font-medium">{d.company.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.capabilities.map(cap => (
                  <tr key={cap.id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">{cap.name}</td>
                    {orderedDetails.map(d => {
                      const w = matrix.weights.get(`${d.company.id}:${cap.id}`);
                      const cell = weightCell(w);
                      return (
                        <td key={d.company.id} className={`text-right px-3 font-mono ${cell.cls}`}>{cell.text}</td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a company</DialogTitle>
            <DialogDescription>Search the catalog and pick one to add to the comparables matrix.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-1">
            {industries.map(i => (
              <button
                key={i.id}
                onClick={() => setPickerIndustryId(i.id)}
                className={`px-2 py-1 text-xs rounded-md border ${pickerIndustryId === i.id ? "bg-primary/10 text-primary border-primary/30" : "border-border hover:bg-muted"}`}
              >
                {i.name}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name…"
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="max-h-80 overflow-y-auto divide-y">
            {optionsLoading ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Loading companies…</p>
            ) : filteredOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No matches in this industry.</p>
            ) : (
              filteredOptions.map((o) => (
                <button
                  key={o.id}
                  onClick={() => addCompany(o.id)}
                  className="w-full text-left px-3 py-2 hover:bg-muted text-sm"
                >
                  {o.name}
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
