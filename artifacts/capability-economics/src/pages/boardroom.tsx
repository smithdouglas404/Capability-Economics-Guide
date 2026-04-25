import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { FileText, Loader2, CheckCircle2, Download, Building2, ArrowRight, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const API_BASE = "/api";

type Role = { id: number; slug: string; title: string; name: string };
type Step = "ready" | "generating" | "done";

const FALLBACK_ROLES: Role[] = [
  { id: 1, slug: "ceo",  title: "CEO",  name: "Chief Executive" },
  { id: 2, slug: "cfo",  title: "CFO",  name: "Chief Financial Officer" },
  { id: 3, slug: "coo",  title: "COO",  name: "Chief Operating Officer" },
  { id: 4, slug: "cio",  title: "CIO",  name: "Chief Information Officer" },
  { id: 5, slug: "cto",  title: "CTO",  name: "Chief Technology Officer" },
  { id: 6, slug: "cmo",  title: "CMO",  name: "Chief Marketing Officer" },
  { id: 7, slug: "chro", title: "CHRO", name: "Chief Human Resources Officer" },
  { id: 8, slug: "cpo",  title: "CPO",  name: "Chief Product Officer" },
];

export default function Boardroom() {
  const [step, setStep] = useState<Step>("ready");
  const [roleSlug, setRoleSlug] = useState<string>("all");
  const [roles, setRoles] = useState<Role[]>(FALLBACK_ROLES);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string>("boardroom.pdf");

  const sessionToken = typeof window !== "undefined"
    ? localStorage.getItem("ce_session_token")
    : null;

  useEffect(() => {
    fetch(`${API_BASE}/csuite`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Role[] | null) => {
        if (Array.isArray(data) && data.length) setRoles(data);
      })
      .catch(() => undefined);
  }, []);

  async function generate() {
    if (!sessionToken) return;
    setStep("generating");
    setError(null);
    try {
      const body: Record<string, unknown> = { sessionToken };
      if (roleSlug && roleSlug !== "all") body.roleSlug = roleSlug;
      const res = await fetch(`${API_BASE}/boardroom/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const e = await res.json(); msg = e.error ?? msg; } catch { /* */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const cd = res.headers.get("Content-Disposition") ?? "";
      const m = cd.match(/filename="?([^"]+)"?/);
      const name = m?.[1] ?? `boardroom-${Date.now()}.pdf`;
      setDownloadUrl(url);
      setDownloadName(name);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("ready");
    }
  }

  function reset() {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl(null);
    setDownloadName("boardroom.pdf");
    setError(null);
    setStep("ready");
  }

  if (!sessionToken) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-3xl">
        <Card className="rounded-none">
          <CardContent className="py-12 text-center">
            <Building2 className="w-12 h-12 text-primary mx-auto mb-4" />
            <p className="font-serif text-xl mb-2">No organization on file</p>
            <p className="text-sm text-muted-foreground mb-6">
              Set up your organization and complete a capability assessment to generate a Boardroom Pack.
            </p>
            <Link href="/organization">
              <Button className="rounded-none">
                Set up organization
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">My Org · Boardroom</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <FileText className="w-8 h-8 text-primary" />
          Boardroom Pack
        </h1>
        <p className="text-muted-foreground max-w-2xl">
          One-click PDF for board meetings — exec summary, gaps, strategy decisions, ROI.
        </p>
      </motion.div>

      {step === "ready" && (
        <Card>
          <CardHeader>
            <CardTitle>Generate the pack</CardTitle>
            <CardDescription>
              Pulls your latest assessments, industry benchmarks, recorded strategy decisions, and ROI ledger into a five-page PDF.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div>
                <Label htmlFor="role">Filter by role (optional)</Label>
                <Select value={roleSlug} onValueChange={setRoleSlug}>
                  <SelectTrigger id="role"><SelectValue placeholder="All capabilities" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All capabilities</SelectItem>
                    {roles.map((r) => (
                      <SelectItem key={r.slug} value={r.slug}>{r.title} — {r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <div className="text-xs text-muted-foreground">
                  Choose a C-suite lens to scope the pack to capabilities mapped to that role. Leave on "All capabilities" for the full readout.
                </div>
              </div>
            </div>

            <div className="rounded-md border bg-muted/30 p-4 mb-6 text-xs text-muted-foreground space-y-1">
              <div className="font-medium text-foreground flex items-center gap-2 text-sm mb-1"><Sparkles className="w-3.5 h-3.5 text-primary" />What's inside</div>
              <div>• Cover page with org, industry, role lens, and period</div>
              <div>• Executive summary narrative — overall vs. industry, top 3 gaps, top 3 strengths</div>
              <div>• Capability gaps chart — sorted by largest gap first</div>
              <div>• Recent strategy decisions table</div>
              <div>• ROI snapshot — spend, revenue impact, net ROI, efficiency gains</div>
            </div>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 mb-4 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end">
              <Button onClick={generate} data-testid="boardroom-generate">
                <FileText className="w-3.5 h-3.5 mr-1" />Generate PDF
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "generating" && (
        <Card>
          <CardContent className="py-16 text-center">
            <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto mb-4" />
            <p className="font-serif text-lg mb-1">Building boardroom pack…</p>
            <p className="text-sm text-muted-foreground">
              Pulling assessments, decisions, and ROI ledger. Usually under 10 seconds.
            </p>
          </CardContent>
        </Card>
      )}

      {step === "done" && (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
            <p className="font-serif text-xl mb-1">Boardroom pack downloaded</p>
            <p className="text-sm text-muted-foreground mb-6">
              {downloadName} should have started downloading. If not, click below.
            </p>
            <div className="flex items-center justify-center gap-2">
              {downloadUrl && (
                <a href={downloadUrl} download={downloadName}>
                  <Button variant="outline" size="sm"><Download className="w-3.5 h-3.5 mr-1" />Re-download</Button>
                </a>
              )}
              <Button size="sm" onClick={reset} data-testid="boardroom-restart">
                Generate another
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
