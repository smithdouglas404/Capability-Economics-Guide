import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Database, Plus, Sparkles, Trash2, Save, X, RefreshCw } from "lucide-react";

type Industry = { id: number; name: string };
type Company = { company: { id: number; name: string }; scores?: unknown };
type Cap = { id: number; name: string; slug: string; industryId: number };
type ProductCap = { capabilityId: number; capabilityName: string; weight: number; evidenceNote: string | null };
type Product = {
  id: number;
  companyId: number;
  name: string;
  description: string;
  category: string | null;
  status: string;
  websiteUrl: string | null;
  source: string;
  capabilities: ProductCap[];
};
type Suggestion = {
  companyName: string;
  companyId: number | null;
  productName: string;
  description: string;
  weight: number;
  evidence: string;
};

const blankForm = (companyId: number) => ({
  id: undefined as number | undefined,
  companyId,
  name: "",
  description: "",
  category: "",
  websiteUrl: "",
  status: "active" as "active" | "preview" | "deprecated" | "discontinued",
  capabilities: [] as Array<{ capabilityId: number; weight: number }>,
});

export default function ProductsAdmin() {
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [industryId, setIndustryId] = useState<number | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [caps, setCaps] = useState<Cap[]>([]);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<ReturnType<typeof blankForm> | null>(null);
  const [seedRunning, setSeedRunning] = useState(false);
  const [seedResult, setSeedResult] = useState<string>("");
  const [researchCapId, setResearchCapId] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [researching, setResearching] = useState(false);

  useEffect(() => {
    fetch("/api/industries").then(r => r.json()).then((rows: Industry[]) => {
      setIndustries(rows);
      if (rows.length) setIndustryId(rows[0].id);
    });
  }, []);

  useEffect(() => {
    if (!industryId) return;
    Promise.all([
      fetch(`/api/workbench/companies?industryId=${industryId}&limit=200`).then(r => r.json()),
      fetch(`/api/capabilities?industryId=${industryId}`).then(r => r.json()),
    ]).then(([co, cp]) => {
      setCompanies(co.companies ?? []);
      setCaps(Array.isArray(cp) ? cp : (cp.capabilities ?? []));
      setCompanyId(co.companies?.[0]?.company?.id ?? null);
    });
  }, [industryId]);

  const reloadProducts = (cid: number) => {
    setLoading(true);
    fetch(`/api/companies/${cid}/products`).then(r => r.json()).then(d => {
      setProducts(d.products ?? []);
      setLoading(false);
    });
  };

  useEffect(() => {
    if (!companyId) { setProducts([]); return; }
    reloadProducts(companyId);
  }, [companyId]);

  const capsForIndustry = useMemo(() => caps.filter(c => c.industryId === industryId), [caps, industryId]);

  const runSeed = async () => {
    setSeedRunning(true);
    setSeedResult("");
    try {
      const r = await fetch("/api/admin/products/_seed", { method: "POST", credentials: "include" });
      const d = await r.json();
      setSeedResult(d.ok ? `Seeded: ${d.inserted} products, ${d.mappings} mappings (${d.skipped} skipped — company not in DB).` : `Failed: ${d.error}`);
      if (companyId) reloadProducts(companyId);
    } catch (e) {
      setSeedResult(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSeedRunning(false);
    }
  };

  const runResearch = async () => {
    if (!researchCapId) return;
    setResearching(true);
    setSuggestions([]);
    try {
      const r = await fetch("/api/admin/products/_research", {
        method: "POST", headers: { "content-type": "application/json" }, credentials: "include",
        body: JSON.stringify({ capabilityId: researchCapId }),
      });
      const d = await r.json();
      setSuggestions(d.suggestions ?? []);
    } finally {
      setResearching(false);
    }
  };

  const acceptSuggestion = async (s: Suggestion) => {
    if (!s.companyId || !researchCapId) return;
    await fetch("/api/admin/products", {
      method: "POST", headers: { "content-type": "application/json" }, credentials: "include",
      body: JSON.stringify({
        companyId: s.companyId,
        name: s.productName,
        description: s.description,
        source: "perplexity",
        capabilities: [{ capabilityId: researchCapId, weight: s.weight, evidenceNote: s.evidence }],
      }),
    });
    setSuggestions(prev => prev.filter(x => x !== s));
    if (s.companyId === companyId) reloadProducts(companyId);
  };

  const saveForm = async () => {
    if (!form || !form.name || !form.capabilities.length) return;
    const body = {
      companyId: form.companyId,
      name: form.name,
      description: form.description,
      category: form.category || null,
      websiteUrl: form.websiteUrl || null,
      status: form.status,
      capabilities: form.capabilities,
    };
    const url = form.id ? `/api/admin/products/${form.id}` : "/api/admin/products";
    const method = form.id ? "PUT" : "POST";
    await fetch(url, { method, headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
    setForm(null);
    if (companyId) reloadProducts(companyId);
  };

  const editProduct = (p: Product) => {
    setForm({
      id: p.id,
      companyId: p.companyId,
      name: p.name,
      description: p.description,
      category: p.category ?? "",
      websiteUrl: p.websiteUrl ?? "",
      status: p.status as "active" | "preview" | "deprecated" | "discontinued",
      capabilities: p.capabilities.map(c => ({ capabilityId: c.capabilityId, weight: c.weight })),
    });
  };

  const removeProduct = async (id: number) => {
    if (!confirm("Delete this product?")) return;
    await fetch(`/api/admin/products/${id}`, { method: "DELETE", credentials: "include" });
    if (companyId) reloadProducts(companyId);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Database className="w-5 h-5" /> Seed known products</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Inserts ~40 well-known products (AWS Bedrock, Salesforce Agentforce, Snowflake Cortex, Stripe Radar, Epic, etc.) and maps them to capabilities they implement. Idempotent — safe to re-run.
          </p>
          <div className="flex items-center gap-3">
            <Button onClick={runSeed} disabled={seedRunning}>
              {seedRunning ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Database className="w-4 h-4 mr-1" />}
              Run seed
            </Button>
            {seedResult && <span className="text-sm text-muted-foreground">{seedResult}</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles className="w-5 h-5" /> Research products for a capability</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-2">
            <select value={industryId ?? ""} onChange={e => setIndustryId(parseInt(e.target.value, 10))} className="border rounded px-3 py-2 bg-background">
              {industries.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            <select value={researchCapId ?? ""} onChange={e => setResearchCapId(e.target.value ? parseInt(e.target.value, 10) : null)} className="border rounded px-3 py-2 bg-background min-w-[260px]">
              <option value="">— choose capability —</option>
              {capsForIndustry.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button onClick={runResearch} disabled={!researchCapId || researching}>
              {researching ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
              Suggest via Perplexity
            </Button>
          </div>
          {suggestions.length > 0 && (
            <div className="border rounded divide-y">
              {suggestions.map((s, i) => (
                <div key={i} className="p-3 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{s.productName} <span className="text-muted-foreground font-normal">— {s.companyName}</span> {!s.companyId && <Badge variant="destructive" className="text-[10px]">company not in DB</Badge>}</div>
                    <div className="text-xs text-muted-foreground">{s.description}</div>
                    <div className="text-[11px] mt-1">Weight {s.weight.toFixed(2)} · <span className="italic">{s.evidence}</span></div>
                  </div>
                  <Button size="sm" disabled={!s.companyId} onClick={() => acceptSuggestion(s)}><Plus className="w-4 h-4 mr-1" />Add</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Products by company</span>
            <div className="flex items-center gap-2">
              <select value={companyId ?? ""} onChange={e => setCompanyId(e.target.value ? parseInt(e.target.value, 10) : null)} className="border rounded px-3 py-2 bg-background text-sm">
                {companies.map(c => <option key={c.company.id} value={c.company.id}>{c.company.name}</option>)}
              </select>
              <Button size="sm" onClick={() => companyId && setForm(blankForm(companyId))} disabled={!companyId}><Plus className="w-4 h-4 mr-1" />New product</Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <p className="text-muted-foreground text-sm">Loading…</p>}
          {!loading && products.length === 0 && <p className="text-muted-foreground text-sm">No products yet for this company.</p>}
          {products.map(p => (
            <div key={p.id} className="border rounded p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{p.name} <Badge variant="outline" className="text-[10px] ml-1">{p.status}</Badge> {p.category && <Badge variant="secondary" className="text-[10px]">{p.category}</Badge>}</div>
                  <div className="text-sm text-muted-foreground">{p.description}</div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {p.capabilities.map(c => (
                      <Badge key={c.capabilityId} variant="outline" className="text-[10px]">{c.capabilityName} · {(c.weight * 100).toFixed(0)}%</Badge>
                    ))}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => editProduct(p)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => removeProduct(p.id)}><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>
            </div>
          ))}

          {form && (
            <div className="border-2 border-primary rounded p-4 space-y-3 bg-muted/20">
              <div className="flex items-center justify-between">
                <div className="font-medium">{form.id ? "Edit product" : "New product"}</div>
                <Button size="sm" variant="ghost" onClick={() => setForm(null)}><X className="w-4 h-4" /></Button>
              </div>
              <Input placeholder="Product name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              <Input placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
              <div className="grid grid-cols-3 gap-2">
                <Input placeholder="Category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} />
                <Input placeholder="https://website" value={form.websiteUrl} onChange={e => setForm({ ...form, websiteUrl: e.target.value })} />
                <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as typeof form.status })} className="border rounded px-3 py-2 bg-background">
                  <option value="active">active</option>
                  <option value="preview">preview</option>
                  <option value="deprecated">deprecated</option>
                  <option value="discontinued">discontinued</option>
                </select>
              </div>
              <div>
                <div className="text-sm font-medium mb-2">Capabilities (weight 0–1)</div>
                <div className="space-y-1 max-h-60 overflow-auto border rounded p-2">
                  {capsForIndustry.map(c => {
                    const existing = form.capabilities.find(x => x.capabilityId === c.id);
                    return (
                      <label key={c.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={!!existing}
                          onChange={e => {
                            if (e.target.checked) {
                              setForm({ ...form, capabilities: [...form.capabilities, { capabilityId: c.id, weight: 0.5 }] });
                            } else {
                              setForm({ ...form, capabilities: form.capabilities.filter(x => x.capabilityId !== c.id) });
                            }
                          }}
                        />
                        <span className="flex-1">{c.name}</span>
                        {existing && (
                          <input
                            type="number" step="0.1" min="0" max="1"
                            value={existing.weight}
                            onChange={e => {
                              const w = parseFloat(e.target.value);
                              setForm({ ...form, capabilities: form.capabilities.map(x => x.capabilityId === c.id ? { ...x, weight: isNaN(w) ? 0.5 : w } : x) });
                            }}
                            className="w-20 border rounded px-2 py-1 text-xs bg-background"
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
              <Button onClick={saveForm} disabled={!form.name || !form.capabilities.length}><Save className="w-4 h-4 mr-1" />{form.id ? "Save" : "Create"}</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
