import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Lock, Save, X, Plus } from "lucide-react";

type Tier = {
  id: number;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  monthlyPriceCents: number | null;
  annualPriceCents: number | null;
  isContactSales: boolean;
  priceLocked: boolean;
  displayOrder: number;
  features: string[];
  ctaLabel: string;
  highlight: boolean;
  active: boolean;
};

function dollarsFromCents(c: number | null): string {
  if (c === null) return "";
  return (c / 100).toString();
}
function centsFromDollars(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function TierEditor({ tier, onSaved }: { tier: Tier; onSaved: () => void }) {
  const [draft, setDraft] = useState<Tier>(tier);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [monthly, setMonthly] = useState(dollarsFromCents(tier.monthlyPriceCents));
  const [annual, setAnnual] = useState(dollarsFromCents(tier.annualPriceCents));
  const [newFeature, setNewFeature] = useState("");

  useEffect(() => {
    setDraft(tier);
    setMonthly(dollarsFromCents(tier.monthlyPriceCents));
    setAnnual(dollarsFromCents(tier.annualPriceCents));
  }, [tier]);

  const dirty =
    draft.name !== tier.name ||
    draft.tagline !== tier.tagline ||
    draft.description !== tier.description ||
    draft.ctaLabel !== tier.ctaLabel ||
    draft.highlight !== tier.highlight ||
    draft.active !== tier.active ||
    draft.isContactSales !== tier.isContactSales ||
    JSON.stringify(draft.features) !== JSON.stringify(tier.features) ||
    monthly !== dollarsFromCents(tier.monthlyPriceCents) ||
    annual !== dollarsFromCents(tier.annualPriceCents);

  async function save() {
    setErr(null);
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: draft.name,
        tagline: draft.tagline,
        description: draft.description,
        ctaLabel: draft.ctaLabel,
        highlight: draft.highlight,
        active: draft.active,
        isContactSales: draft.isContactSales,
        features: draft.features,
      };
      if (!tier.priceLocked) {
        body.monthlyPriceCents = centsFromDollars(monthly);
        body.annualPriceCents = centsFromDollars(annual);
      }
      const res = await fetch(`/api/membership/tiers/${tier.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function addFeature() {
    const t = newFeature.trim();
    if (!t) return;
    setDraft({ ...draft, features: [...draft.features, t] });
    setNewFeature("");
  }

  function removeFeature(idx: number) {
    setDraft({ ...draft, features: draft.features.filter((_, i) => i !== idx) });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            {draft.name}
            {tier.priceLocked && (
              <Badge variant="outline" className="gap-1 text-xs">
                <Lock className="w-3 h-3" /> price locked
              </Badge>
            )}
            {draft.highlight && <Badge className="text-xs">popular</Badge>}
            {!draft.active && <Badge variant="destructive" className="text-xs">hidden</Badge>}
          </span>
          <span className="text-xs text-muted-foreground font-mono">{tier.slug}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label>Display name</Label>
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-testid={`input-tier-name-${tier.slug}`} />
          </div>
          <div>
            <Label>CTA button label</Label>
            <Input value={draft.ctaLabel} onChange={(e) => setDraft({ ...draft, ctaLabel: e.target.value })} data-testid={`input-tier-cta-${tier.slug}`} />
          </div>
        </div>
        <div>
          <Label>Tagline (one line, shown under the name)</Label>
          <Input value={draft.tagline} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} data-testid={`input-tier-tagline-${tier.slug}`} />
        </div>
        <div>
          <Label>Description (front of card)</Label>
          <Textarea
            rows={3}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            data-testid={`input-tier-description-${tier.slug}`}
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label>Monthly price (USD)</Label>
            <Input
              type="number"
              min="0"
              step="1"
              placeholder="e.g. 299"
              disabled={tier.priceLocked}
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              data-testid={`input-tier-monthly-${tier.slug}`}
            />
            <p className="text-xs text-muted-foreground mt-1">Leave blank to hide monthly option.</p>
          </div>
          <div>
            <Label>Annual price (USD)</Label>
            <Input
              type="number"
              min="0"
              step="1"
              placeholder="e.g. 2990"
              disabled={tier.priceLocked}
              value={annual}
              onChange={(e) => setAnnual(e.target.value)}
              data-testid={`input-tier-annual-${tier.slug}`}
            />
            {tier.priceLocked && (
              <p className="text-xs text-muted-foreground mt-1">This tier's price is locked at the schema level.</p>
            )}
          </div>
        </div>
        <div>
          <Label>Features (back of card)</Label>
          <div className="space-y-1.5 mt-1.5">
            {draft.features.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-sm bg-muted/40 rounded px-2.5 py-1.5">
                <span className="flex-1">{f}</span>
                <Button size="sm" variant="ghost" onClick={() => removeFeature(i)} data-testid={`button-remove-feature-${tier.slug}-${i}`}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Input
                placeholder="Add a feature line..."
                value={newFeature}
                onChange={(e) => setNewFeature(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFeature(); }}}
                data-testid={`input-add-feature-${tier.slug}`}
              />
              <Button onClick={addFeature} variant="outline" data-testid={`button-add-feature-${tier.slug}`}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-6 pt-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={draft.highlight} onCheckedChange={(v) => setDraft({ ...draft, highlight: v })} data-testid={`switch-highlight-${tier.slug}`} />
            Mark as "Most popular"
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={draft.isContactSales} onCheckedChange={(v) => setDraft({ ...draft, isContactSales: v })} data-testid={`switch-contact-sales-${tier.slug}`} />
            Contact sales (hide monthly price)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={draft.active} onCheckedChange={(v) => setDraft({ ...draft, active: v })} data-testid={`switch-active-${tier.slug}`} />
            Show on public page
          </label>
        </div>
        {err && <div className="text-sm text-destructive">{err}</div>}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" disabled={!dirty || saving} onClick={() => { setDraft(tier); setMonthly(dollarsFromCents(tier.monthlyPriceCents)); setAnnual(dollarsFromCents(tier.annualPriceCents)); setErr(null); }} data-testid={`button-tier-cancel-${tier.slug}`}>
            Cancel
          </Button>
          <Button disabled={!dirty || saving} onClick={save} data-testid={`button-tier-save-${tier.slug}`} className="gap-1.5">
            <Save className="w-4 h-4" /> {saving ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MembershipAdmin() {
  const [tiers, setTiers] = useState<Tier[] | null>(null);

  async function load() {
    const r = await fetch("/api/membership/tiers/all");
    setTiers(await r.json());
  }
  useEffect(() => { load(); }, []);

  if (!tiers) return <div className="text-sm text-muted-foreground">Loading membership tiers...</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-serif font-bold mb-1">Membership tiers</h2>
        <p className="text-sm text-muted-foreground">Edit pricing, descriptions, and what's included on each tier. Changes are live immediately on the public /membership page.</p>
      </div>
      {tiers.map((t) => <TierEditor key={t.id} tier={t} onSaved={load} />)}
    </div>
  );
}
