import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Shield,
  Lock,
  Server,
  FileText,
  Key,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Scale,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface RegOverviewRow {
  regulation: { id: number; shortCode: string; jurisdiction: string };
  overallCompliance: number | null;
  total: number;
  criticalGaps: number;
}

function CompliancePostureCard() {
  const [rows, setRows] = useState<RegOverviewRow[] | null>(null);
  useEffect(() => {
    fetch("/api/regulations/overview")
      .then(r => r.ok ? r.json() : null)
      .then((d: { rows?: RegOverviewRow[] } | null) => setRows(d?.rows ?? null))
      .catch(() => setRows(null));
  }, []);
  if (!rows || rows.length === 0) return null;
  const top5 = rows.slice(0, 5);
  return (
    <Card className="rounded-none border-l-2 border-l-emerald-500/40">
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Scale className="w-4 h-4 text-emerald-600" />
            <h2 className="font-serif text-xl tracking-tight">Live compliance posture</h2>
          </div>
          <Link href="/regulations" className="text-xs text-primary hover:underline">View full board →</Link>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          {rows.length} regulations mapped to your capability requirements. Showing top 5 by EVaR-weighted exposure.
        </p>
        <ul className="space-y-1.5">
          {top5.map(r => (
            <li key={r.regulation.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="font-mono text-xs">{r.regulation.shortCode}</span>
              <span className="flex items-center gap-3 text-xs">
                <span className="text-muted-foreground">{r.total} reqs</span>
                {r.criticalGaps > 0 && <span className="text-destructive">{r.criticalGaps} critical gaps</span>}
                {r.overallCompliance !== null && (
                  <span className={r.overallCompliance >= 80 ? "text-emerald-600 dark:text-emerald-400" : r.overallCompliance >= 50 ? "text-amber-600" : "text-destructive"}>
                    {r.overallCompliance}%
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export default function SecurityPage() {
  return (
    <div className="container mx-auto px-4 py-10 max-w-4xl space-y-8">
      <div>
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="w-3.5 h-3.5" />
          Home
        </Link>
        <div className="flex items-center gap-2 mb-1">
          <Shield className="w-5 h-5 text-sky-500" />
          <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">Security & compliance</Badge>
        </div>
        <h1 className="font-serif text-4xl tracking-tight">Security, identity, and data lineage</h1>
        <p className="text-base text-muted-foreground mt-3 max-w-3xl leading-relaxed">
          A summary of how the platform handles identity, data, and deployment options for enterprise buyers.
          For procurement documentation or a signed DPA, contact <a href="mailto:security@inflexcvi.ai" className="text-primary hover:underline">security@inflexcvi.ai</a>.
        </p>
      </div>

      {/* Live compliance posture — CISO/CSO visible-posture tile pulled from /regulations */}
      <CompliancePostureCard />

      <Card className="rounded-none border-border/60">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-serif text-2xl tracking-tight">Identity & SSO</h2>
          </div>
          <p className="text-sm leading-relaxed">
            All authentication is brokered by <a href="https://clerk.com" className="text-primary hover:underline">Clerk</a>.
            SAML 2.0 SSO is supported on the Enterprise plan with the following identity providers tested end-to-end:
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {["Okta", "Azure AD / Entra ID", "Google Workspace", "OneLogin", "Auth0", "Custom SAML IdP"].map(idp => (
              <Badge key={idp} variant="outline" className="rounded-none font-mono text-[11px] uppercase tracking-wider inline-flex items-center gap-1 justify-start px-2 py-1.5">
                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                {idp}
              </Badge>
            ))}
          </div>
          <Separator className="my-2" />
          <ul className="text-sm space-y-1.5 list-disc list-outside ml-5">
            <li>SCIM provisioning available for automated user lifecycle management.</li>
            <li>Multi-factor authentication enforced by default for Enterprise tenants.</li>
            <li>Per-organization session lifetime and IP allowlists configurable in the admin portal.</li>
            <li>Audit-log access to every authentication event via the same Clerk admin API your IT team already integrates with.</li>
          </ul>
          <p className="text-sm text-muted-foreground italic">
            To enable SAML on your tenant, reply to your account email confirmation with your IdP metadata XML or a SAML setup URL — turnaround is typically one business day.
          </p>
        </CardContent>
      </Card>

      <Card className="rounded-none border-border/60">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-serif text-2xl tracking-tight">Data lineage & provenance</h2>
          </div>
          <p className="text-sm leading-relaxed">
            Every CVI score on the platform carries machine-readable provenance: the source label, methodology
            tag (consulting / academic / regulatory / news / seed), Bayesian posterior variance, GDP weighting,
            and last-queried timestamp. The <code className="font-mono text-xs bg-muted px-1">ScoreWithProvenance</code> UI
            component surfaces this on hover; the same data is available programmatically via{" "}
            <code className="font-mono text-xs bg-muted px-1">GET /api/capabilities/:id/quality</code>.
          </p>
          <ul className="text-sm space-y-1.5 list-disc list-outside ml-5">
            <li><strong>Source-quality audit</strong>: <Link href="/admin/source-quality" className="text-primary hover:underline">/admin/source-quality</Link> flags every capability with single-source dependence, stale triangulations, missing consulting corroboration, or wide credible intervals.</li>
            <li><strong>Industry GDP weights</strong>: the global CVI rollup includes only industries with a Perplexity-cited GDP weight (<code className="font-mono text-xs bg-muted px-1">industry_gdp_weights</code> table, every row carries a source URL). Industries without a cited weight are excluded from the rollup — never weighted by an editorial fallback.</li>
            <li><strong>Backtesting harness</strong>: see <Link href="/proof" className="text-primary hover:underline">/proof</Link> for the historical-event replay accuracy. The harness measures model propagation under shock, not historical reconstruction.</li>
            <li><strong>Audit log</strong>: every admin action and analyst annotation is recorded in <code className="font-mono text-xs bg-muted px-1">admin_audit_log</code>, queryable by actor, action, target, and date range with CSV export.</li>
          </ul>
          <p className="text-sm text-muted-foreground italic">
            We publish a formal Data Lineage Document on request — includes the full provenance JSON-Schema, source-quality SLAs, and the methodology version history.
          </p>
        </CardContent>
      </Card>

      <Card className="rounded-none border-border/60">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-serif text-2xl tracking-tight">Deployment options</h2>
          </div>
          <p className="text-sm leading-relaxed">
            The default platform is SaaS, hosted on Railway with Postgres, Redis, and an isolated tenant
            database per Enterprise account. Two additional options exist for regulated industries:
          </p>
          <div className="space-y-3 mt-2">
            <div className="border border-border/40 p-3">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider bg-sky-500/15 text-sky-500 border-sky-500/40">Available</Badge>
                <strong>SaaS (multi-tenant) — recommended path</strong>
              </div>
              <p className="text-xs text-muted-foreground">
                Per-org row-level isolation enforced via Clerk identity. Default for Console and Platform tiers.
                Multi-tenant features — including the team marketplace workspace (shared purchases, team-owned seller accounts),
                organization-shared Workbench boards, and peer-cohort benchmarking — are <strong>cloud-only</strong> and rely on
                Clerk org memberships. On-premise deployments fall back to per-user equivalents.
              </p>
            </div>
            <div className="border border-border/40 p-3">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider bg-amber-500/15 text-amber-500 border-amber-500/40">Contact sales</Badge>
                <strong>Single-tenant VPC</strong>
              </div>
              <p className="text-xs text-muted-foreground">
                Your data, your dedicated Postgres + Redis + storage instances, deployed into our VPC.
                The same codebase — capability data is pulled from your tenant only. Available for Platform tier customers on annual contracts.
              </p>
            </div>
            <div className="border border-border/40 p-3">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider bg-amber-500/15 text-amber-500 border-amber-500/40">Contact sales</Badge>
                <strong>On-premise / customer VPC</strong>
              </div>
              <p className="text-xs text-muted-foreground">
                Deploy into your AWS / Azure / GCP VPC, behind your VPN. The api-server, inflexcvi SPA,
                and the optional Mem0 / Letta sidecars all ship as Docker images. You provide Postgres and Redis;
                we provide an admin runbook and signed support agreement. Available for regulated industries
                (financial services, healthcare, defense, public sector) under signed MSA.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-none border-border/60">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-serif text-2xl tracking-tight">Encryption & access</h2>
          </div>
          <ul className="text-sm space-y-1.5 list-disc list-outside ml-5">
            <li>TLS 1.3 in transit. Postgres encrypted at rest (AES-256). Database backups encrypted with customer-managed keys for VPC deployments.</li>
            <li>API keys are scoped per-customer with monthly quotas and per-minute rate limits. Revocable from the user dashboard or via admin API.</li>
            <li>Marketplace report files are watermarked with the purchasing user's identity at download time, preventing un-attributed redistribution.</li>
            <li>Service-to-service traffic between api-server and AI providers (OpenRouter, Anthropic, Perplexity) flows over HTTPS only. No credentials are persisted in logs.</li>
          </ul>
        </CardContent>
      </Card>

      <Card className="rounded-none border-border/60">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-serif text-2xl tracking-tight">Compliance & certifications</h2>
          </div>
          <p className="text-sm leading-relaxed">
            We can support the following compliance frameworks under signed contracts. Note that the SaaS
            tier inherits the underlying hosting provider's certifications; single-tenant and on-premise
            deployments allow direct attestation under the customer's own framework.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {["SOC 2 Type II", "GDPR", "CCPA", "HIPAA (VPC)", "ISO 27001", "FedRAMP (on-prem)"].map(c => (
              <Badge key={c} variant="outline" className="rounded-none font-mono text-[11px] uppercase tracking-wider inline-flex items-center gap-1 justify-start px-2 py-1.5">
                <Shield className="w-3 h-3 text-sky-500" />
                {c}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="text-center pt-4">
        <p className="text-sm text-muted-foreground">
          Need a procurement packet, signed DPA, or vendor risk assessment?{" "}
          <a href="mailto:security@inflexcvi.ai" className="text-primary hover:underline inline-flex items-center gap-1">
            <ExternalLink className="w-3 h-3" />
            security@inflexcvi.ai
          </a>
        </p>
      </div>
    </div>
  );
}
