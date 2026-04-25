import { useCallback, useEffect, useState } from "react";
import { useUser } from "@clerk/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle, CheckCircle2, Copy, Download, Key, KeyRound, Loader2, LogOut,
  PauseCircle, Trash2, UserCircle, Users, UserPlus, XCircle,
} from "lucide-react";
import { PERSONA_LIST, PERSONA_META } from "@/lib/persona-nav";

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
  stripeCustomerId: string | null;
  currentPeriodEnd: string | null;
};

type ApiKey = {
  id: number;
  label: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type OrgSummary = {
  org: {
    id: number;
    name: string;
    slug: string;
    seatLimit: number;
    status: string;
    tierId: number | null;
    stripeSubscriptionId: string | null;
    stripeCustomerId: string | null;
    defaultPersonaSlug: string | null;
  };
  role: string;
  joinedAt: string;
};

type TierOption = { id: number; slug: string; name: string; monthlyPriceCents: number | null; annualPriceCents: number | null };

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

  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [newOrgName, setNewOrgName] = useState("");
  const [inviteEmails, setInviteEmails] = useState<Record<number, string>>({});
  const [orgDetails, setOrgDetails] = useState<Record<number, { members: { userId: string; email: string | null; role: string }[]; pendingInvites: { id: number; email: string; role: string; expiresAt: string }[] }>>({});
  const [tierOptions, setTierOptions] = useState<TierOption[]>([]);
  const [selectedTier, setSelectedTier] = useState<Record<number, string>>({});
  const [seatInput, setSeatInput] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    if (!isLoaded || !user) return;
    setLoading(true);
    try {
      const [mRes, kRes, oRes, tRes] = await Promise.all([
        fetch(`${API_BASE}/me/membership`, { credentials: "include" }),
        fetch(`${API_BASE}/me/api-keys`, { credentials: "include" }),
        fetch(`${API_BASE}/billing-orgs/mine`, { credentials: "include" }),
        fetch(`${API_BASE}/membership/tiers/all`, { credentials: "include" }),
      ]);
      if (tRes.ok) {
        const tiers = await tRes.json() as TierOption[];
        setTierOptions(tiers.filter(t => (t.annualPriceCents ?? 0) > 0));
      }
      if (mRes.ok) {
        const mJson = await mRes.json() as { membership: Membership | null; tier: Tier | null };
        setMembership(mJson.membership);
        setTier(mJson.tier);
      }
      if (kRes.ok) {
        const kJson = await kRes.json() as { keys: ApiKey[] };
        setKeys(kJson.keys);
      }
      if (oRes.ok) {
        const oJson = await oRes.json() as { organizations: OrgSummary[] };
        setOrgs(oJson.organizations);
        // Pre-fetch detail for each org the user can manage
        for (const o of oJson.organizations) {
          if (o.role === "owner" || o.role === "admin") {
            void fetchOrgDetail(o.org.id);
          }
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [isLoaded, user]);

  const fetchOrgDetail = async (orgId: number) => {
    try {
      const res = await fetch(`${API_BASE}/billing-orgs/${orgId}`, { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json() as {
        members: { userId: string; email: string | null; role: string }[];
        pendingInvites: { id: number; email: string; role: string; expiresAt: string }[];
      };
      setOrgDetails(d => ({ ...d, [orgId]: { members: json.members, pendingInvites: json.pendingInvites } }));
    } catch (e) {
      console.error(e);
    }
  };

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

  const openBillingPortal = async () => {
    setBusyId("billing-portal");
    try {
      const res = await fetch(`${API_BASE}/me/billing-portal`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as { url: string };
      window.location.href = json.url;
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusyId(null);
    }
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

  const createOrg = async () => {
    if (!newOrgName.trim()) return;
    setBusyId("create-org");
    try {
      const res = await fetch(`${API_BASE}/billing-orgs`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newOrgName.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      setNewOrgName("");
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const subscribeOrg = async (orgId: number) => {
    const tierId = Number(selectedTier[orgId] ?? "");
    if (!tierId) { alert("Pick a tier first."); return; }
    setBusyId(`subscribe-${orgId}`);
    try {
      const res = await fetch(`${API_BASE}/billing-orgs/${orgId}/checkout`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tierId, billing: "annual" }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as { checkoutUrl: string };
      window.location.href = json.checkoutUrl;
    } catch (e) {
      alert((e as Error).message);
      setBusyId(null);
    }
  };

  const openOrgPortal = async (orgId: number) => {
    setBusyId(`portal-${orgId}`);
    try {
      const res = await fetch(`${API_BASE}/billing-orgs/${orgId}/billing-portal`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as { url: string };
      window.location.href = json.url;
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const updateSeats = async (orgId: number) => {
    const n = Number(seatInput[orgId] ?? "");
    if (!Number.isFinite(n) || n <= 0) return;
    setBusyId(`seats-${orgId}`);
    try {
      const res = await fetch(`${API_BASE}/billing-orgs/${orgId}/seats`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seatLimit: n }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSeatInput(m => ({ ...m, [orgId]: "" }));
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const setDefaultPersona = async (orgId: number, slug: string | null) => {
    setBusyId(`default-persona-${orgId}`);
    try {
      const res = await fetch(`${API_BASE}/billing-orgs/${orgId}/default-persona`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const inviteMember = async (orgId: number) => {
    const email = (inviteEmails[orgId] ?? "").trim();
    if (!email) return;
    setBusyId(`invite-${orgId}`);
    try {
      const res = await fetch(`${API_BASE}/billing-orgs/${orgId}/invites`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: "member" }),
      });
      if (!res.ok) throw new Error(await res.text());
      setInviteEmails(m => ({ ...m, [orgId]: "" }));
      await fetchOrgDetail(orgId);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const revokeInvite = async (orgId: number, inviteId: number) => {
    setBusyId(`revoke-invite-${inviteId}`);
    try {
      const res = await fetch(`${API_BASE}/billing-orgs/${orgId}/invites/${inviteId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      await fetchOrgDetail(orgId);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const transferOwnership = async (orgId: number, toUserId: string) => {
    if (!confirm("Transfer ownership? You'll be demoted to admin, the new owner will be billed for future renewals.")) return;
    setBusyId(`transfer-${orgId}`);
    try {
      const res = await fetch(`${API_BASE}/billing-orgs/${orgId}/transfer-ownership`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toUserId }),
      });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const removeMember = async (orgId: number, targetUserId: string) => {
    if (!confirm("Remove this member from the team?")) return;
    setBusyId(`remove-${targetUserId}`);
    try {
      const res = await fetch(`${API_BASE}/billing-orgs/${orgId}/members/${encodeURIComponent(targetUserId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      await fetchOrgDetail(orgId);
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
                {membership.stripeCustomerId && (
                  <Button variant="outline" onClick={openBillingPortal} disabled={busyId === "billing-portal"} className="rounded-none">
                    {busyId === "billing-portal" ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                    <span className="ml-2">Manage billing</span>
                  </Button>
                )}
                {membership.status === "active" && !membership.stripeCustomerId && (
                  <Button variant="outline" onClick={cancel} disabled={busyId === "cancel"} className="rounded-none border-red-300 text-red-700 hover:bg-red-50">
                    {busyId === "cancel" ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                    <span className="ml-2">Cancel membership</span>
                  </Button>
                )}
              </div>
              {membership.currentPeriodEnd && (
                <p className="text-xs text-muted-foreground">Next renewal: {new Date(membership.currentPeriodEnd).toLocaleDateString()}</p>
              )}
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

      {/* Organizations */}
      <Card className="rounded-none">
        <CardHeader>
          <CardTitle className="text-base font-serif flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            Your teams
          </CardTitle>
          <CardDescription>Billing teams you belong to. Your effective tier is the highest of your personal membership and any team membership.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label htmlFor="new-org">Create a new team</Label>
              <Input
                id="new-org"
                placeholder="Team name (e.g. Acme Strategy)"
                value={newOrgName}
                onChange={e => setNewOrgName(e.target.value)}
                className="rounded-none"
              />
            </div>
            <Button onClick={createOrg} disabled={!newOrgName.trim() || busyId === "create-org"} className="rounded-none">
              {busyId === "create-org" ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              <span className="ml-2">Create</span>
            </Button>
          </div>

          {orgs.length === 0 ? (
            <p className="text-sm text-muted-foreground">You don't belong to any teams yet.</p>
          ) : (
            <div className="space-y-4">
              {orgs.map(({ org, role }) => {
                const detail = orgDetails[org.id];
                const canManage = role === "owner" || role === "admin";
                const activeCount = detail?.members.length ?? 0;
                const pendingCount = detail?.pendingInvites.length ?? 0;
                return (
                  <div key={org.id} className="border border-border p-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <div className="font-medium">{org.name}</div>
                        <div className="text-xs text-muted-foreground">
                          Your role: <span className="font-mono">{role}</span> · Seats: {activeCount + pendingCount}/{org.seatLimit}
                        </div>
                      </div>
                      {canManage && detail && (
                        <Button size="sm" variant="ghost" onClick={() => fetchOrgDetail(org.id)} className="h-7">
                          <Loader2 className={`w-3 h-3 ${busyId?.startsWith(`invite-${org.id}`) ? "animate-spin" : "opacity-0"}`} />
                        </Button>
                      )}
                    </div>

                    {role === "owner" && (
                      <div className="mt-3 p-3 border-l-2 border-primary bg-primary/5">
                        {!org.stripeSubscriptionId ? (
                          <div className="space-y-2">
                            <div className="text-sm font-medium">Subscribe to activate team access</div>
                            <p className="text-xs text-muted-foreground">Members inherit the team's tier. Billed as seats × per-seat price, annually.</p>
                            <div className="flex gap-2 items-end flex-wrap">
                              <div className="flex-1 min-w-[180px]">
                                <Label className="text-xs">Tier</Label>
                                <select
                                  className="w-full border border-border px-2 py-1.5 rounded-none text-sm"
                                  value={selectedTier[org.id] ?? ""}
                                  onChange={e => setSelectedTier(m => ({ ...m, [org.id]: e.target.value }))}
                                >
                                  <option value="">Select tier…</option>
                                  {tierOptions.map(t => (
                                    <option key={t.id} value={String(t.id)}>
                                      {t.name}{t.annualPriceCents != null ? ` — $${(t.annualPriceCents / 100).toLocaleString()}/seat/yr` : ""}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="text-xs text-muted-foreground shrink-0">
                                × {org.seatLimit} seats
                              </div>
                              <Button
                                size="sm"
                                onClick={() => subscribeOrg(org.id)}
                                disabled={!selectedTier[org.id] || busyId === `subscribe-${org.id}`}
                                className="rounded-none"
                              >
                                {busyId === `subscribe-${org.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                                <span className="ml-1">Subscribe</span>
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="text-sm font-medium flex items-center gap-2">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              Subscribed ({org.status})
                            </div>
                            <div className="flex gap-2 items-end flex-wrap">
                              <div className="flex-1 min-w-[120px]">
                                <Label className="text-xs">Change seat count</Label>
                                <Input
                                  type="number"
                                  placeholder={String(org.seatLimit)}
                                  value={seatInput[org.id] ?? ""}
                                  onChange={e => setSeatInput(m => ({ ...m, [org.id]: e.target.value }))}
                                  className="rounded-none h-8"
                                />
                              </div>
                              <Button size="sm" variant="outline" onClick={() => updateSeats(org.id)} disabled={!seatInput[org.id] || busyId === `seats-${org.id}`} className="rounded-none">
                                {busyId === `seats-${org.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : "Update"}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => openOrgPortal(org.id)} disabled={busyId === `portal-${org.id}`} className="rounded-none">
                                {busyId === `portal-${org.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                                <span className="ml-1">Manage billing</span>
                              </Button>
                            </div>

                            <div className="border-t pt-3 mt-2">
                              <Label className="text-xs">Default persona for new invitees</Label>
                              <p className="text-xs text-muted-foreground mb-2">
                                {org.defaultPersonaSlug
                                  ? <>New members land in <span className="font-mono">{PERSONA_META[org.defaultPersonaSlug as keyof typeof PERSONA_META]?.label ?? org.defaultPersonaSlug}</span> on first sign-in. Existing members keep their current persona.</>
                                  : "No default — new invitees see the persona picker on first sign-in."
                                }
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {PERSONA_LIST.map((p) => {
                                  const isActive = org.defaultPersonaSlug === p.slug;
                                  return (
                                    <Button
                                      key={p.slug}
                                      size="sm"
                                      variant={isActive ? "default" : "outline"}
                                      onClick={() => setDefaultPersona(org.id, p.slug)}
                                      disabled={busyId === `default-persona-${org.id}`}
                                      className="rounded-none h-7 text-xs"
                                      data-testid={`org-default-persona-${p.slug}`}
                                    >
                                      {p.shortLabel}
                                    </Button>
                                  );
                                })}
                                {org.defaultPersonaSlug && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setDefaultPersona(org.id, null)}
                                    disabled={busyId === `default-persona-${org.id}`}
                                    className="rounded-none h-7 text-xs text-muted-foreground"
                                  >
                                    Clear
                                  </Button>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {canManage && detail && (
                      <div className="mt-3 space-y-3">
                        <div className="flex gap-2 items-end">
                          <div className="flex-1">
                            <Label htmlFor={`invite-${org.id}`} className="text-xs">Invite teammate by email</Label>
                            <Input
                              id={`invite-${org.id}`}
                              type="email"
                              placeholder="teammate@company.com"
                              value={inviteEmails[org.id] ?? ""}
                              onChange={e => setInviteEmails(m => ({ ...m, [org.id]: e.target.value }))}
                              className="rounded-none"
                            />
                          </div>
                          <Button
                            size="sm"
                            onClick={() => inviteMember(org.id)}
                            disabled={!inviteEmails[org.id]?.trim() || busyId === `invite-${org.id}`}
                            className="rounded-none"
                          >
                            {busyId === `invite-${org.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                            <span className="ml-1">Invite</span>
                          </Button>
                        </div>

                        {detail.pendingInvites.length > 0 && (
                          <div>
                            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Pending invites</div>
                            <ul className="space-y-1">
                              {detail.pendingInvites.map(inv => (
                                <li key={inv.id} className="flex items-center justify-between text-sm">
                                  <span>{inv.email} <span className="text-xs text-muted-foreground">({inv.role})</span></span>
                                  <Button size="sm" variant="ghost" onClick={() => revokeInvite(org.id, inv.id)} disabled={busyId === `revoke-invite-${inv.id}`} className="h-7 text-red-600 hover:bg-red-50">
                                    {busyId === `revoke-invite-${inv.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                                    <span className="ml-1">Revoke</span>
                                  </Button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {detail.members.length > 0 && (
                          <div>
                            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Members</div>
                            <ul className="space-y-1">
                              {detail.members.map(m => (
                                <li key={m.userId} className="flex items-center justify-between text-sm">
                                  <span>{m.email ?? m.userId} <span className="text-xs text-muted-foreground">({m.role})</span></span>
                                  <div className="flex items-center gap-1">
                                    {role === "owner" && m.role !== "owner" && (
                                      <Button size="sm" variant="ghost" onClick={() => transferOwnership(org.id, m.userId)} disabled={busyId === `transfer-${org.id}`} className="h-7 text-xs">
                                        {busyId === `transfer-${org.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                                        <span className="ml-1">Make owner</span>
                                      </Button>
                                    )}
                                    {m.role !== "owner" && (
                                      <Button size="sm" variant="ghost" onClick={() => removeMember(org.id, m.userId)} disabled={busyId === `remove-${m.userId}`} className="h-7 text-red-600 hover:bg-red-50">
                                        {busyId === `remove-${m.userId}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                                        <span className="ml-1">Remove</span>
                                      </Button>
                                    )}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
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
