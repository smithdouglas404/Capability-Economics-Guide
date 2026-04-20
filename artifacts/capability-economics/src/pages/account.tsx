import { useCallback, useEffect, useState } from "react";
import { useUser } from "@clerk/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle, CheckCircle2, Copy, Download, Key, KeyRound, Loader2, LogOut,
  PauseCircle, Trash2, UserCircle, XCircle,
} from "lucide-react";

const API_BASE = "/api";

type Tier = { id: number; slug: string; name: string };

type Membership = {
  id: number;
  tierId: number;
  status: "pending" | "active" | "rejected" | "cancelled";
  paymentMethod: string;
  paymentStatus: string;
  requestedAt: string;
  approvedAt: string | null;
};

type ApiKey = {
  id: number;
  label: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

const statusBadge = (s: Membership["status"]) => {
  const map = {
    active: { label: "Active", cls: "bg-emerald-500/10 text-emerald-700 border border-emerald-500/20", Icon: CheckCircle2 },
    pending: { label: "Pending", cls: "bg-amber-500/10 text-amber-700 border border-amber-500/20", Icon: PauseCircle },
    cancelled: { label: "Cancelled", cls: "bg-slate-500/10 text-slate-700 border border-slate-500/20", Icon: PauseCircle },
    rejected: { label: "Rejected", cls: "bg-red-500/10 text-red-700 border border-red-500/20", Icon: XCircle },
  }[s];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${map.cls}`}>
      <map.Icon className="w-3 h-3" />
      {map.label}
    </span>
  );
};

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");

export default function AccountPage() {
  const { user, isLoaded } = useUser();
  const [membership, setMembership] = useState<Membership | null>(null);
  const [tier, setTier] = useState<Tier | null>(null);
  const [loading, setLoading] = useState(true);

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [lastIssuedKey, setLastIssuedKey] = useState<{ raw: string; label: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isLoaded || !user) return;
    setLoading(true);
    try {
      const [mRes, kRes] = await Promise.all([
        fetch(`${API_BASE}/me/membership`, { credentials: "include" }),
        fetch(`${API_BASE}/me/api-keys`, { credentials: "include" }),
      ]);
      if (mRes.ok) {
        const mJson = await mRes.json() as { membership: Membership | null; tier: Tier | null };
        setMembership(mJson.membership);
        setTier(mJson.tier);
      }
      if (kRes.ok) {
        const kJson = await kRes.json() as { keys: ApiKey[] };
        setKeys(kJson.keys);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [isLoaded, user]);

  useEffect(() => { void load(); }, [load]);

  const cancel = async () => {
    if (!confirm("Cancel your membership? You'll lose access when this takes effect.")) return;
    setBusyId("cancel");
    try {
      const res = await fetch(`${API_BASE}/me/membership/cancel`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const downloadData = () => {
    window.location.href = `${API_BASE}/me/export`;
  };

  const createKey = async () => {
    if (!newKeyLabel.trim()) return;
    setBusyId("create-key");
    try {
      const res = await fetch(`${API_BASE}/me/api-keys`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newKeyLabel.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as { raw: string; label: string };
      setLastIssuedKey({ raw: json.raw, label: json.label });
      setNewKeyLabel("");
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const revokeKey = async (id: number) => {
    if (!confirm("Revoke this key? Any integration using it will lose access immediately.")) return;
    setBusyId(`revoke-${id}`);
    try {
      const res = await fetch(`${API_BASE}/me/api-keys/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (!isLoaded) return <div className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;
  if (!user) return <div className="p-12 text-center text-muted-foreground">Sign in to manage your account.</div>;

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
      <div>
        <h1 className="font-serif text-3xl flex items-center gap-2">
          <UserCircle className="w-7 h-7 text-primary" />
          Your Account
        </h1>
        <p className="text-muted-foreground text-sm mt-1">{user.primaryEmailAddress?.emailAddress ?? user.id}</p>
      </div>

      {/* Membership */}
      <Card className="rounded-none">
        <CardHeader>
          <CardTitle className="text-base font-serif">Membership</CardTitle>
          <CardDescription>Your current subscription tier and status.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : !membership ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">You don't have an active membership yet.</p>
              <Button asChild className="rounded-none">
                <a href="/membership">Apply for membership</a>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-lg font-serif">{tier?.name ?? `Tier #${membership.tierId}`}</span>
                {statusBadge(membership.status)}
              </div>
              <dl className="text-sm space-y-1 text-muted-foreground">
                <div className="flex justify-between"><dt>Payment</dt><dd className="font-mono">{membership.paymentMethod} · {membership.paymentStatus}</dd></div>
                <div className="flex justify-between"><dt>Requested</dt><dd>{fmtDate(membership.requestedAt)}</dd></div>
                <div className="flex justify-between"><dt>Approved</dt><dd>{fmtDate(membership.approvedAt)}</dd></div>
              </dl>
              <div className="flex gap-2 flex-wrap">
                <Button asChild variant="outline" className="rounded-none">
                  <a href="/membership">Change tier</a>
                </Button>
                <Button asChild variant="outline" className="rounded-none">
                  <a href={`${API_BASE}/me/memberships/${membership.id}/invoice.pdf`} target="_blank" rel="noopener">
                    <Download className="w-4 h-4" />
                    <span className="ml-2">Invoice PDF</span>
                  </a>
                </Button>
                {membership.status === "active" && (
                  <Button variant="outline" onClick={cancel} disabled={busyId === "cancel"} className="rounded-none border-red-300 text-red-700 hover:bg-red-50">
                    {busyId === "cancel" ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                    <span className="ml-2">Cancel membership</span>
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Data export */}
      <Card className="rounded-none">
        <CardHeader>
          <CardTitle className="text-base font-serif">Your data</CardTitle>
          <CardDescription>Download a copy of everything we store about you — memberships, credits, transactions, KYC records — as JSON.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={downloadData} variant="outline" className="rounded-none">
            <Download className="w-4 h-4" />
            <span className="ml-2">Download my data</span>
          </Button>
        </CardContent>
      </Card>

      {/* API keys */}
      <Card className="rounded-none">
        <CardHeader>
          <CardTitle className="text-base font-serif flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-primary" />
            API keys
          </CardTitle>
          <CardDescription>For programmatic access — include in the <code className="text-xs bg-muted px-1">Authorization: Bearer &lt;key&gt;</code> header.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label htmlFor="user-new-key">Label</Label>
              <Input
                id="user-new-key"
                placeholder="e.g. Python analytics script"
                value={newKeyLabel}
                onChange={e => setNewKeyLabel(e.target.value)}
                className="rounded-none"
              />
            </div>
            <Button onClick={createKey} disabled={!newKeyLabel.trim() || busyId === "create-key"} className="rounded-none">
              {busyId === "create-key" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
              <span className="ml-2">Create key</span>
            </Button>
          </div>

          {lastIssuedKey && (
            <div className="p-3 border-l-4 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-sm">
              <div className="font-medium mb-1 flex items-center gap-1">
                <AlertTriangle className="w-4 h-4" />
                Copy this key now. It will never be shown again.
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-2 py-1 bg-background font-mono text-xs break-all">{lastIssuedKey.raw}</code>
                <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(lastIssuedKey.raw)} className="rounded-none">
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}

          {keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No keys yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2">Label</th>
                    <th className="px-3 py-2">Prefix</th>
                    <th className="px-3 py-2">Last used</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map(k => (
                    <tr key={k.id} className="border-b">
                      <td className="px-3 py-2 font-medium">{k.label}</td>
                      <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{k.prefix}…</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{k.lastUsedAt ? fmtDate(k.lastUsedAt) : "Never"}</td>
                      <td className="px-3 py-2 text-xs">
                        {k.revokedAt ? <span className="text-red-700">Revoked</span> : <span className="text-emerald-700">Active</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {!k.revokedAt && (
                          <Button size="sm" variant="outline" onClick={() => revokeKey(k.id)} disabled={busyId === `revoke-${k.id}`} className="h-7 rounded-none border-red-300 text-red-700 hover:bg-red-50">
                            {busyId === `revoke-${k.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            <span className="ml-1">Revoke</span>
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
