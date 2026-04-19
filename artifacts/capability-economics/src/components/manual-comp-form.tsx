import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Gift, Loader2, AlertTriangle } from "lucide-react";

const API_BASE = "/api";

type Tier = {
  id: number;
  slug: string;
  name: string;
  monthlyPriceCents: number | null;
  annualPriceCents: number | null;
  active: boolean;
};

type Props = {
  onGranted?: () => void;
};

export default function ManualCompForm({ onGranted }: Props) {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [tiersLoading, setTiersLoading] = useState(true);
  const [userId, setUserId] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [tierId, setTierId] = useState<string>("");
  const [entityType, setEntityType] = useState<"individual" | "company">("individual");
  const [entityName, setEntityName] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: true; tierName: string; target: string } | { ok: false; error: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/membership/tiers/all`, { credentials: "include" });
        const json = await res.json();
        setTiers(Array.isArray(json) ? json.filter((t: Tier) => t.active) : []);
      } catch (e) {
        console.error("failed to load tiers", e);
      } finally {
        setTiersLoading(false);
      }
    })();
  }, []);

  const reset = () => {
    setUserId(""); setUserEmail(""); setUserName("");
    setTierId(""); setEntityType("individual"); setEntityName("");
    setNotes("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    if (!userId.trim()) { setResult({ ok: false, error: "User ID is required (Clerk user id, e.g. user_2abc...)" }); return; }
    if (!tierId) { setResult({ ok: false, error: "Select a tier" }); return; }
    if (!entityName.trim()) { setResult({ ok: false, error: "Entity name is required" }); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/admin/payments/comp`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: userId.trim(),
          userEmail: userEmail.trim() || undefined,
          userName: userName.trim() || undefined,
          tierId: Number(tierId),
          entityType,
          entityName: entityName.trim(),
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const tierName = tiers.find(t => t.id === Number(tierId))?.name ?? "(tier)";
      setResult({ ok: true, tierName, target: userEmail || userName || userId });
      reset();
      onGranted?.();
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : "Failed" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="rounded-none">
      <CardHeader>
        <CardTitle className="text-base font-serif flex items-center gap-2">
          <Gift className="w-5 h-5 text-primary" />
          Grant Membership Manually
        </CardTitle>
        <CardDescription>
          Upgrade a user outside the Stripe / invoice / crypto flow. Creates an active membership record immediately with payment method "invoice · COMP".
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Label htmlFor="comp-userid">Clerk User ID <span className="text-destructive">*</span></Label>
            <Input
              id="comp-userid"
              placeholder="user_2abc123..."
              value={userId}
              onChange={e => setUserId(e.target.value)}
              className="font-mono text-sm rounded-none"
              required
            />
            <p className="text-xs text-muted-foreground mt-1">
              Find this in the Clerk dashboard → Users → click the user → "User ID" at the top.
            </p>
          </div>

          <div>
            <Label htmlFor="comp-email">Email (optional)</Label>
            <Input
              id="comp-email"
              type="email"
              placeholder="person@company.com"
              value={userEmail}
              onChange={e => setUserEmail(e.target.value)}
              className="rounded-none"
            />
          </div>

          <div>
            <Label htmlFor="comp-name">Display name (optional)</Label>
            <Input
              id="comp-name"
              placeholder="Jane Doe"
              value={userName}
              onChange={e => setUserName(e.target.value)}
              className="rounded-none"
            />
          </div>

          <div>
            <Label htmlFor="comp-tier">Tier <span className="text-destructive">*</span></Label>
            <Select value={tierId} onValueChange={setTierId}>
              <SelectTrigger id="comp-tier" className="rounded-none">
                <SelectValue placeholder={tiersLoading ? "Loading tiers..." : "Select a tier"} />
              </SelectTrigger>
              <SelectContent>
                {tiers.map(t => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}
                    {t.annualPriceCents != null ? ` — $${(t.annualPriceCents / 100).toLocaleString()}/yr` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="comp-entity-type">Entity type</Label>
            <Select value={entityType} onValueChange={v => setEntityType(v as typeof entityType)}>
              <SelectTrigger id="comp-entity-type" className="rounded-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="individual">Individual</SelectItem>
                <SelectItem value="company">Company</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="md:col-span-2">
            <Label htmlFor="comp-entity-name">Entity name <span className="text-destructive">*</span></Label>
            <Input
              id="comp-entity-name"
              placeholder={entityType === "company" ? "Acme Inc." : "Jane Doe"}
              value={entityName}
              onChange={e => setEntityName(e.target.value)}
              className="rounded-none"
              required
            />
          </div>

          <div className="md:col-span-2">
            <Label htmlFor="comp-notes">Notes (internal, optional)</Label>
            <Textarea
              id="comp-notes"
              placeholder="Why this comp? e.g. Early adopter, partner agreement, incident credit..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="rounded-none min-h-[80px]"
            />
          </div>

          <div className="md:col-span-2 flex items-center justify-between gap-3">
            {result && result.ok && (
              <div className="text-sm text-emerald-700 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                Granted {result.tierName} to {result.target}.
              </div>
            )}
            {result && !result.ok && (
              <div className="text-sm text-red-700 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                {result.error}
              </div>
            )}
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="outline" onClick={reset} disabled={submitting} className="rounded-none">
                Clear
              </Button>
              <Button type="submit" disabled={submitting} className="rounded-none">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Gift className="w-4 h-4 mr-2" />}
                Grant Membership
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
