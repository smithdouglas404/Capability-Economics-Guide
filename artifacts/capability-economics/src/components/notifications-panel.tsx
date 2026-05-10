import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bell, Loader2, Plus, Trash2 } from "lucide-react";

const API_BASE = "/api";

type Subscription = {
  id: number;
  targetType: "capability_threshold" | "lifecycle_change" | "macro_event" | "quadrant_transition";
  targetId: number | null;
  condition: Record<string, unknown>;
  channel: "email" | "slack" | "webhook";
  channelTarget: string | null;
  frequency: "realtime" | "daily_digest";
  label: string | null;
  active: number;
  lastTriggeredAt: string | null;
  createdAt: string;
};

type Delivery = {
  id: number;
  subscriptionId: number;
  subject: string;
  status: string;
  channel: string;
  createdAt: string;
  sentAt: string | null;
};

type CapabilityLite = { id: number; name: string };
type IndustryLite = { id: number; name: string };
type CompanyLite = { id: number; name: string };

const TARGET_TYPE_LABEL: Record<Subscription["targetType"], string> = {
  capability_threshold: "Capability score threshold",
  lifecycle_change: "Capability lifecycle change",
  macro_event: "Macro event",
  quadrant_transition: "Company quadrant transition",
};

export default function NotificationsPanel() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityLite[]>([]);
  const [industries, setIndustries] = useState<IndustryLite[]>([]);
  const [companies, setCompanies] = useState<CompanyLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [newType, setNewType] = useState<Subscription["targetType"]>("capability_threshold");
  const [newCapId, setNewCapId] = useState<string>("");
  const [newIndustryId, setNewIndustryId] = useState<string>("");
  const [newCompanyId, setNewCompanyId] = useState<string>("");
  const [newDirection, setNewDirection] = useState<"above" | "below">("above");
  const [newThreshold, setNewThreshold] = useState<string>("70");
  const [newMinSeverity, setNewMinSeverity] = useState<string>("6");
  const [newChannel, setNewChannel] = useState<"email" | "slack" | "webhook">("email");
  const [newChannelTarget, setNewChannelTarget] = useState<string>("");
  const [newFrequency, setNewFrequency] = useState<"realtime" | "daily_digest">("realtime");
  const [newLabel, setNewLabel] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, dRes, cRes, iRes, coRes] = await Promise.all([
        fetch(`${API_BASE}/me/subscriptions`, { credentials: "include" }),
        fetch(`${API_BASE}/me/notifications/recent`, { credentials: "include" }),
        fetch(`${API_BASE}/capabilities?limit=400`, { credentials: "include" }),
        fetch(`${API_BASE}/industries`, { credentials: "include" }),
        fetch(`${API_BASE}/companies?limit=200`, { credentials: "include" }),
      ]);
      if (sRes.ok) setSubs((await sRes.json() as { subscriptions: Subscription[] }).subscriptions);
      if (dRes.ok) setDeliveries((await dRes.json() as { deliveries: Delivery[] }).deliveries);
      if (cRes.ok) {
        const j = await cRes.json() as { capabilities?: CapabilityLite[]; items?: CapabilityLite[] };
        setCapabilities(j.capabilities ?? j.items ?? []);
      }
      if (iRes.ok) {
        const j = await iRes.json() as { industries?: IndustryLite[] } | IndustryLite[];
        setIndustries(Array.isArray(j) ? j : (j.industries ?? []));
      }
      if (coRes.ok) {
        const j = await coRes.json() as { companies?: Array<{ company: CompanyLite }> | CompanyLite[] };
        const arr = Array.isArray(j.companies) ? j.companies : [];
        setCompanies(arr.map(x => "company" in x ? x.company : x as CompanyLite));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    let targetId: number | null = null;
    let condition: Record<string, unknown> = {};
    if (newType === "capability_threshold") {
      const capId = Number(newCapId);
      if (!capId) { alert("Pick a capability"); return; }
      targetId = capId;
      condition = { capabilityId: capId, direction: newDirection, threshold: Number(newThreshold) };
    } else if (newType === "lifecycle_change") {
      const capId = Number(newCapId);
      if (!capId) { alert("Pick a capability"); return; }
      targetId = capId;
      condition = { capabilityId: capId };
    } else if (newType === "macro_event") {
      const indId = Number(newIndustryId);
      condition = { industryId: indId || undefined, minSeverity: Number(newMinSeverity) };
      targetId = indId || null;
    } else if (newType === "quadrant_transition") {
      const coId = Number(newCompanyId);
      condition = { companyId: coId || undefined };
      targetId = coId || null;
    }

    setBusy("create");
    try {
      const res = await fetch(`${API_BASE}/me/subscriptions`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetType: newType,
          targetId,
          condition,
          channel: newChannel,
          channelTarget: newChannel === "email" ? null : newChannelTarget || null,
          frequency: newFrequency,
          label: newLabel || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setNewLabel(""); setNewChannelTarget("");
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this alert subscription?")) return;
    setBusy(`del-${id}`);
    try {
      await fetch(`${API_BASE}/me/subscriptions/${id}`, { method: "DELETE", credentials: "include" });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const toggleActive = async (sub: Subscription) => {
    setBusy(`toggle-${sub.id}`);
    try {
      await fetch(`${API_BASE}/me/subscriptions/${sub.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: !sub.active }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const capName = (id: number | null) => capabilities.find(c => c.id === id)?.name ?? `#${id}`;
  const indName = (id: number | null) => industries.find(c => c.id === id)?.name ?? "Any industry";
  const coName = (id: number | null) => companies.find(c => c.id === id)?.name ?? "Any company";

  const summary = (s: Subscription): string => {
    const c = s.condition;
    if (s.targetType === "capability_threshold") {
      return `${capName(s.targetId)} ${(c as { direction: string }).direction} ${(c as { threshold: number }).threshold}`;
    }
    if (s.targetType === "lifecycle_change") return `${capName(s.targetId)} lifecycle change`;
    if (s.targetType === "macro_event") return `${indName(s.targetId)} · severity ≥ ${(c as { minSeverity: number }).minSeverity}`;
    if (s.targetType === "quadrant_transition") return `${coName(s.targetId)} quadrant change`;
    return s.label ?? "Alert";
  };

  return (
    <Card className="rounded-none">
      <CardHeader>
        <CardTitle className="text-base font-serif flex items-center gap-2">
          <Bell className="w-5 h-5 text-primary" />
          Alerts &amp; notifications
        </CardTitle>
        <CardDescription>
          Subscribe to capability score thresholds, lifecycle changes, macro events, and quadrant transitions.
          Email delivery on every tier; Slack and webhook delivery require Platform.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* New subscription */}
        <div className="border border-border p-3 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Plus className="w-4 h-4" /> New alert
          </div>
          <div className="grid md:grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Trigger</Label>
              <select className="w-full border border-border px-2 py-1.5 rounded-none text-sm" value={newType} onChange={e => setNewType(e.target.value as Subscription["targetType"])}>
                <option value="capability_threshold">Capability score crosses threshold</option>
                <option value="lifecycle_change">Capability lifecycle changes</option>
                <option value="macro_event">Macro event affects watched industry</option>
                <option value="quadrant_transition">Company changes quadrant</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Label (optional)</Label>
              <Input className="rounded-none h-9" placeholder="e.g. Watch Cyber Risk" value={newLabel} onChange={e => setNewLabel(e.target.value)} />
            </div>
          </div>

          {(newType === "capability_threshold" || newType === "lifecycle_change") && (
            <div className="grid md:grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Capability</Label>
                <select className="w-full border border-border px-2 py-1.5 rounded-none text-sm" value={newCapId} onChange={e => setNewCapId(e.target.value)}>
                  <option value="">Select…</option>
                  {capabilities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {newType === "capability_threshold" && (
                <>
                  <div>
                    <Label className="text-xs">Direction</Label>
                    <select className="w-full border border-border px-2 py-1.5 rounded-none text-sm" value={newDirection} onChange={e => setNewDirection(e.target.value as "above" | "below")}>
                      <option value="above">crosses above</option>
                      <option value="below">crosses below</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs">Threshold (0-100)</Label>
                    <Input className="rounded-none h-9" type="number" min={0} max={100} value={newThreshold} onChange={e => setNewThreshold(e.target.value)} />
                  </div>
                </>
              )}
            </div>
          )}

          {newType === "macro_event" && (
            <div className="grid md:grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Industry (blank = all)</Label>
                <select className="w-full border border-border px-2 py-1.5 rounded-none text-sm" value={newIndustryId} onChange={e => setNewIndustryId(e.target.value)}>
                  <option value="">All industries</option>
                  {industries.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Min severity (0-10)</Label>
                <Input className="rounded-none h-9" type="number" min={0} max={10} value={newMinSeverity} onChange={e => setNewMinSeverity(e.target.value)} />
              </div>
            </div>
          )}

          {newType === "quadrant_transition" && (
            <div>
              <Label className="text-xs">Company (blank = any)</Label>
              <select className="w-full border border-border px-2 py-1.5 rounded-none text-sm" value={newCompanyId} onChange={e => setNewCompanyId(e.target.value)}>
                <option value="">Any company</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          <div className="grid md:grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Channel</Label>
              <select className="w-full border border-border px-2 py-1.5 rounded-none text-sm" value={newChannel} onChange={e => setNewChannel(e.target.value as "email" | "slack" | "webhook")}>
                <option value="email">Email</option>
                <option value="slack">Slack (Platform)</option>
                <option value="webhook">Webhook (Platform)</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Frequency</Label>
              <select className="w-full border border-border px-2 py-1.5 rounded-none text-sm" value={newFrequency} onChange={e => setNewFrequency(e.target.value as "realtime" | "daily_digest")}>
                <option value="realtime">Real-time</option>
                <option value="daily_digest">Daily digest</option>
              </select>
            </div>
            {(newChannel === "slack" || newChannel === "webhook") && (
              <div>
                <Label className="text-xs">{newChannel === "slack" ? "Slack incoming webhook URL" : "Webhook URL"}</Label>
                <Input className="rounded-none h-9" placeholder="https://hooks.slack.com/…" value={newChannelTarget} onChange={e => setNewChannelTarget(e.target.value)} />
              </div>
            )}
          </div>

          <div>
            <Button size="sm" onClick={create} disabled={busy === "create"} className="rounded-none">
              {busy === "create" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              <span className="ml-2">Create alert</span>
            </Button>
          </div>
        </div>

        {/* Active subscriptions */}
        <div>
          <div className="text-sm font-medium mb-2">Your subscriptions</div>
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : subs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No alerts yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                  <tr><th className="text-left px-2 py-2">Trigger</th><th className="text-left px-2 py-2">Channel</th><th className="text-left px-2 py-2">Frequency</th><th className="text-left px-2 py-2">Status</th><th className="text-right px-2 py-2">Actions</th></tr>
                </thead>
                <tbody>
                  {subs.map(s => (
                    <tr key={s.id} className="border-b">
                      <td className="px-2 py-2">
                        <div className="font-medium">{s.label ?? TARGET_TYPE_LABEL[s.targetType]}</div>
                        <div className="text-xs text-muted-foreground">{summary(s)}</div>
                      </td>
                      <td className="px-2 py-2 text-xs">
                        {s.channel}
                        {s.channelTarget && <div className="text-[10px] text-muted-foreground truncate max-w-[180px]">{s.channelTarget}</div>}
                      </td>
                      <td className="px-2 py-2 text-xs">{s.frequency === "realtime" ? "Real-time" : "Daily digest"}</td>
                      <td className="px-2 py-2 text-xs">
                        <span className={s.active ? "text-emerald-700" : "text-muted-foreground"}>{s.active ? "Active" : "Paused"}</span>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => toggleActive(s)} disabled={busy === `toggle-${s.id}`}>
                          {s.active ? "Pause" : "Resume"}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-red-700" onClick={() => remove(s.id)} disabled={busy === `del-${s.id}`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent deliveries */}
        <div>
          <div className="text-sm font-medium mb-2">Recent activity</div>
          {deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No alerts have fired yet.</p>
          ) : (
            <ul className="text-xs space-y-1 max-h-60 overflow-y-auto border border-border p-2">
              {deliveries.map(d => (
                <li key={d.id} className="flex justify-between gap-2 border-b border-border/50 pb-1">
                  <span className="truncate">{d.subject}</span>
                  <span className="text-muted-foreground shrink-0">
                    {d.channel} · {d.status} · {new Date(d.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
