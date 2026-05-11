import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, RefreshCw, Star, StarOff, Loader2, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

/**
 * Admin page for managing the homepage analogy-card rotation.
 *
 * Lists every case study with:
 *   - whether it has an economics_breakdown populated
 *   - the company name + event title (if populated)
 *   - a regenerate button (re-runs Perplexity research)
 *   - a feature toggle (only one case study can be featured at a time; the
 *     featured one drives the homepage analogy card via /api/featured-case-study)
 *
 * All actions hit admin endpoints; user must be signed in as admin (the
 * AdminOnly wrapper in App.tsx enforces this).
 */

interface CaseStudyRow {
  id: number;
  industryId: number;
  industrySlug: string;
  industryName: string;
  title: string;
  isFeatured: boolean;
  hasEconomicsBreakdown: boolean;
  economicsCompanyName: string | null;
  economicsEventTitle: string | null;
  generatedAt: string;
}

const ADMIN_KEY_STORAGE = "ce.admin-key";

function getAdminKey(): string | null {
  try { return localStorage.getItem(ADMIN_KEY_STORAGE); }
  catch { return null; }
}

function adminHeaders(): Record<string, string> {
  const k = getAdminKey();
  return k ? { "X-Admin-Key": k, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

export default function AdminCaseStudiesPage() {
  const [rows, setRows] = useState<CaseStudyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<Record<number, boolean>>({});
  const [companyInputs, setCompanyInputs] = useState<Record<number, string>>({});
  const [adminKey, setAdminKey] = useState<string>(getAdminKey() ?? "");

  function persistAdminKey(v: string) {
    setAdminKey(v);
    try { localStorage.setItem(ADMIN_KEY_STORAGE, v); } catch {}
  }

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/admin/case-studies", { headers: adminHeaders() });
      if (res.status === 401) { setError("Set the admin key below to load case studies."); setRows([]); return; }
      if (!res.ok) { setError(`Load failed: HTTP ${res.status}`); setRows([]); return; }
      const data = await res.json() as { caseStudies: CaseStudyRow[] };
      setRows(data.caseStudies);
      // Pre-fill company inputs with the existing economics company name if present.
      const inputs: Record<number, string> = {};
      for (const r of data.caseStudies) {
        if (r.economicsCompanyName) inputs[r.id] = r.economicsCompanyName;
      }
      setCompanyInputs(inputs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setRows([]);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [adminKey]);

  async function regenerate(id: number) {
    const companyName = (companyInputs[id] ?? "").trim();
    if (!companyName) { setError("Enter a company name first"); return; }
    setRegenerating(prev => ({ ...prev, [id]: true }));
    setError(null);
    try {
      const res = await fetch(`/api/admin/case-studies/${id}/regenerate-economics-breakdown`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ companyName }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown" }));
        setError(`Regenerate failed: ${body.error ?? res.status}`);
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setRegenerating(prev => ({ ...prev, [id]: false }));
    }
  }

  async function toggleFeatured(id: number, makeFeatured: boolean) {
    setError(null);
    try {
      const res = await fetch(`/api/admin/case-studies/${id}/feature`, {
        method: "PATCH",
        headers: adminHeaders(),
        body: JSON.stringify({ featured: makeFeatured }),
      });
      if (!res.ok) {
        setError(`Toggle failed: HTTP ${res.status}`);
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-6">
        <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="w-3.5 h-3.5" /> Admin home
        </Link>
        <h1 className="font-serif text-3xl tracking-tight">Case-study rotation</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-3xl leading-relaxed">
          Manage which case study renders on the homepage analogy card. Each case study can have a Perplexity-researched economics breakdown (revenue exposure, cost allocation, value generated, unlocked value) attached.
          Only one case study is featured at a time — flipping the star moves the spotlight.
        </p>
      </div>

      <Card className="rounded-none border-border/60 mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Admin key</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="admin-key" className="text-xs text-muted-foreground">
            Pasted once and stored in localStorage. Required for the admin endpoints.
          </Label>
          <Input
            id="admin-key"
            type="password"
            value={adminKey}
            onChange={e => persistAdminKey(e.target.value)}
            placeholder="X-Admin-Key value"
            className="rounded-none font-mono text-xs"
          />
        </CardContent>
      </Card>

      {error && (
        <div className="mb-4 border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2 rounded-none">
          {error}
        </div>
      )}

      <Card className="rounded-none border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Case studies ({rows?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows === null ? (
            <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No case studies yet — generate some via the agent first.</div>
          ) : (
            <div className="divide-y divide-border/40">
              {rows.map(r => {
                const busy = regenerating[r.id] === true;
                return (
                  <div key={r.id} className="p-4 grid lg:grid-cols-[1fr_320px] gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">
                          {r.industryName}
                        </Badge>
                        {r.isFeatured && (
                          <Badge className="rounded-none font-mono text-[10px] uppercase tracking-wider bg-amber-500/15 text-amber-600 border-amber-500/30">
                            Featured
                          </Badge>
                        )}
                        {r.hasEconomicsBreakdown ? (
                          <Badge className="rounded-none font-mono text-[10px] uppercase tracking-wider bg-emerald-500/15 text-emerald-700 border-emerald-500/30">
                            Economics: {r.economicsCompanyName} — {r.economicsEventTitle}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                            No economics breakdown yet
                          </Badge>
                        )}
                      </div>
                      <div className="font-serif text-base leading-tight">{r.title}</div>
                      <Link
                        href={`/case-study/${r.industrySlug}`}
                        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mt-1"
                      >
                        View case study <ExternalLink className="w-3 h-3" />
                      </Link>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`co-${r.id}`} className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Company for economics research
                      </Label>
                      <Input
                        id={`co-${r.id}`}
                        value={companyInputs[r.id] ?? ""}
                        onChange={e => setCompanyInputs(prev => ({ ...prev, [r.id]: e.target.value }))}
                        placeholder="e.g. Progressive Corp"
                        className="rounded-none text-xs h-8"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-none text-[11px] flex-1"
                          disabled={busy}
                          onClick={() => regenerate(r.id)}
                        >
                          {busy
                            ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            : <RefreshCw className="w-3 h-3 mr-1" />}
                          {r.hasEconomicsBreakdown ? "Regenerate" : "Research"}
                        </Button>
                        <Button
                          size="sm"
                          variant={r.isFeatured ? "default" : "outline"}
                          className="rounded-none text-[11px]"
                          onClick={() => toggleFeatured(r.id, !r.isFeatured)}
                        >
                          {r.isFeatured
                            ? <><StarOff className="w-3 h-3 mr-1" /> Unfeature</>
                            : <><Star className="w-3 h-3 mr-1" /> Feature</>}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
