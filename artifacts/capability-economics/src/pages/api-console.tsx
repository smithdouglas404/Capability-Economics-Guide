import { useState } from "react";
import { motion } from "framer-motion";
import { Code2, Send, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const API_BASE = "/api";

type Endpoint = {
  id: string;
  method: "GET" | "POST";
  path: string;
  group: string;
  description: string;
  params?: Array<{ key: string; label: string; placeholder?: string; required?: boolean; in: "query" | "path" }>;
  body?: { template: string };
};

const ENDPOINTS: Endpoint[] = [
  { id: "cei-current", method: "GET", path: "/cei/current", group: "CEI", description: "Latest snapshot of the composite index." },
  { id: "cei-history", method: "GET", path: "/cei/history", group: "CEI", description: "Time series of CEI snapshots.", params: [{ key: "limit", label: "limit", placeholder: "30", in: "query" }] },
  { id: "cei-methodology", method: "GET", path: "/cei/methodology", group: "CEI", description: "Bayesian formula, prior derivation, velocity EMA decay." },
  { id: "cei-components", method: "GET", path: "/cei/components", group: "CEI", description: "Per-capability posterior + velocity.", params: [{ key: "industryId", label: "industryId", placeholder: "1", in: "query" }] },
  { id: "cei-freshness", method: "GET", path: "/cei/freshness", group: "CEI", description: "How stale every capability is." },
  { id: "industries", method: "GET", path: "/industries", group: "Catalog", description: "All industries." },
  { id: "capabilities", method: "GET", path: "/capabilities", group: "Catalog", description: "All approved capabilities.", params: [{ key: "industryId", label: "industryId", placeholder: "1", in: "query" }] },
  { id: "companies", method: "GET", path: "/companies", group: "Catalog", description: "Companies catalog.", params: [{ key: "industryId", label: "industryId", placeholder: "1", in: "query" }] },
  { id: "ontology", method: "GET", path: "/ontology", group: "Ontology", description: "Cross-industry capability relationships.", params: [{ key: "industryId", label: "industryId", placeholder: "1", in: "query" }] },
  { id: "data-sources", method: "GET", path: "/data-sources", group: "Citations", description: "Citation database.", params: [{ key: "ids", label: "ids (comma-separated)", placeholder: "1,2,3", in: "query" }] },
  { id: "replication", method: "POST", path: "/replication/bundle", group: "Replication", description: "Replication bundle (download).", body: { template: '{\n  "industryId": 1\n}' } },
];

const GROUPS = ["CEI", "Catalog", "Ontology", "Citations", "Replication"];

export default function ApiConsolePage() {
  const [activeId, setActiveId] = useState(ENDPOINTS[0].id);
  const [paramValues, setParamValues] = useState<Record<string, Record<string, string>>>({});
  const [bodyValues, setBodyValues] = useState<Record<string, string>>({});
  const [response, setResponse] = useState<{ status: number; body: string; ms: number } | null>(null);
  const [sending, setSending] = useState(false);

  const active = ENDPOINTS.find((e) => e.id === activeId)!;

  function setParam(epId: string, key: string, value: string) {
    setParamValues((prev) => ({ ...prev, [epId]: { ...prev[epId], [key]: value } }));
  }

  function getParam(epId: string, key: string): string {
    return paramValues[epId]?.[key] ?? "";
  }

  function getBody(epId: string, defaultValue: string): string {
    return bodyValues[epId] ?? defaultValue;
  }

  function buildPath(ep: Endpoint): string {
    let path = ep.path;
    const query: string[] = [];
    for (const p of ep.params ?? []) {
      const v = getParam(ep.id, p.key).trim();
      if (!v) continue;
      if (p.in === "path") path = path.replace(`:${p.key}`, encodeURIComponent(v));
      else query.push(`${encodeURIComponent(p.key)}=${encodeURIComponent(v)}`);
    }
    return query.length ? `${path}?${query.join("&")}` : path;
  }

  async function send() {
    setSending(true);
    setResponse(null);
    const path = buildPath(active);
    const url = `${API_BASE}${path}`;
    const t0 = performance.now();
    try {
      const init: RequestInit = { method: active.method, credentials: "include" };
      if (active.method === "POST" && active.body) {
        init.headers = { "Content-Type": "application/json" };
        init.body = getBody(active.id, active.body.template);
      }
      const res = await fetch(url, init);
      const ms = Math.round(performance.now() - t0);
      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not json */ }
      setResponse({ status: res.status, body: pretty, ms });
    } catch (err) {
      setResponse({ status: 0, body: `Network error: ${(err as Error).message}`, ms: Math.round(performance.now() - t0) });
    }
    setSending(false);
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Researcher · API</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <Code2 className="w-8 h-8 text-primary" />
          API Console
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Interactive playground. Pick an endpoint, fill parameters, click Send. Same auth as the rest of the app.
        </p>
      </motion.div>

      <div className="grid grid-cols-12 gap-6">
        <aside className="col-span-12 lg:col-span-3">
          <div className="space-y-4">
            {GROUPS.map((g) => (
              <div key={g}>
                <h2 className="font-serif text-xs uppercase tracking-widest text-muted-foreground mb-2">{g}</h2>
                <div className="space-y-1">
                  {ENDPOINTS.filter((e) => e.group === g).map((e) => (
                    <button
                      key={e.id}
                      onClick={() => { setActiveId(e.id); setResponse(null); }}
                      data-testid={`endpoint-${e.id}`}
                      className={`w-full text-left rounded-md px-3 py-2 transition-colors text-sm ${
                        e.id === activeId ? "bg-primary/10 text-primary border border-primary/30" : "hover:bg-muted border border-transparent"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={`text-[10px] font-mono px-1.5 ${e.method === "POST" ? "text-amber-700" : "text-emerald-700"}`}>
                          {e.method}
                        </Badge>
                        <span className="font-mono text-xs truncate">{e.path}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="col-span-12 lg:col-span-9 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="font-serif text-lg flex items-center gap-2">
                <Badge className={`font-mono ${active.method === "POST" ? "bg-amber-500/10 text-amber-700" : "bg-emerald-500/10 text-emerald-700"}`}>{active.method}</Badge>
                <code className="text-sm">{active.path}</code>
              </CardTitle>
              <CardDescription>{active.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {active.params && active.params.length > 0 && (
                <div className="grid gap-3 md:grid-cols-2">
                  {active.params.map((p) => (
                    <div key={p.key}>
                      <Label htmlFor={`p-${p.key}`}>
                        {p.label}
                        {p.required && <span className="text-destructive ml-1">*</span>}
                        <span className="ml-2 text-xs text-muted-foreground">{p.in}</span>
                      </Label>
                      <Input
                        id={`p-${p.key}`}
                        data-testid={`param-${p.key}`}
                        placeholder={p.placeholder}
                        value={getParam(active.id, p.key)}
                        onChange={(e) => setParam(active.id, p.key, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              )}

              {active.body && (
                <div>
                  <Label htmlFor="body">Body (JSON)</Label>
                  <textarea
                    id="body"
                    data-testid="body-input"
                    className="w-full font-mono text-xs rounded-md border bg-background p-3 min-h-[120px]"
                    value={getBody(active.id, active.body.template)}
                    onChange={(e) => setBodyValues((p) => ({ ...p, [active.id]: e.target.value }))}
                  />
                </div>
              )}

              <div className="flex items-center justify-between">
                <code className="text-xs text-muted-foreground font-mono break-all">
                  {API_BASE}{buildPath(active)}
                </code>
                <Button onClick={send} disabled={sending} data-testid="send-btn">
                  {sending ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Sending…</> : <><Send className="w-3.5 h-3.5 mr-1" />Send</>}
                </Button>
              </div>
            </CardContent>
          </Card>

          {response && (
            <Card>
              <CardHeader>
                <CardTitle className="font-serif text-lg flex items-center gap-3">
                  <Badge className={`font-mono ${response.status >= 200 && response.status < 300 ? "bg-emerald-500/10 text-emerald-700" : "bg-rose-500/10 text-rose-700"}`}>
                    {response.status || "ERR"}
                  </Badge>
                  <span className="text-xs text-muted-foreground font-mono">{response.ms}ms</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs font-mono bg-muted p-3 rounded overflow-x-auto max-h-[600px] overflow-y-auto" data-testid="response-body">
                  <code>{response.body}</code>
                </pre>
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}
