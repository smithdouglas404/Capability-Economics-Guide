import { useCallback, useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, Clock, FileText, Loader2,
  Plus, Send, Store, Upload, XCircle,
} from "lucide-react";
import { MarketplaceNav } from "@/components/marketplace-nav";

import { MobileNotice } from "@/components/mobile";
const API_BASE = "/api";

type Seller = {
  id: number;
  stripeAccountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
};

type Listing = {
  id: number;
  title: string;
  description: string;
  priceCents: number;
  status: "draft" | "pending_review" | "approved" | "rejected" | "archived";
  rejectionReason: string | null;
  fileKey: string | null;
  fileOriginalName: string | null;
  previewFileKey: string | null;
};

const fmtMoney = (c: number) => `$${(c / 100).toFixed(2)}`;

const statusBadge = (s: Listing["status"]) => {
  const map = {
    draft:          { label: "Draft",          cls: "bg-muted/40 text-muted-foreground border border-border/40", Icon: FileText },
    pending_review: { label: "In review",      cls: "bg-amber-500/10 text-amber-700 border border-amber-500/20", Icon: Clock },
    approved:       { label: "Live",           cls: "bg-emerald-500/10 text-emerald-700 border border-emerald-500/20", Icon: CheckCircle2 },
    rejected:       { label: "Rejected",       cls: "bg-red-500/10 text-red-700 border border-red-500/20", Icon: XCircle },
    archived:       { label: "Archived",       cls: "bg-muted/40 text-muted-foreground/60 border border-border/40", Icon: XCircle },
  }[s];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${map.cls}`}>
      <map.Icon className="w-3 h-3" />
      {map.label}
    </span>
  );
};

export default function MarketplaceSellPage() {
  const { user, isLoaded } = useUser();
  const [seller, setSeller] = useState<Seller | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priceDollars, setPriceDollars] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [sRes, lRes] = await Promise.all([
        fetch(`${API_BASE}/marketplace/sellers/me`, { credentials: "include" }),
        fetch(`${API_BASE}/marketplace/my-listings`, { credentials: "include" }),
      ]);
      if (sRes.ok) setSeller((await sRes.json()).seller);
      if (lRes.ok) setListings((await lRes.json()).listings ?? []);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  // After returning from Stripe onboarding (?onboarded=1), refresh state.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("onboarded")) {
      void fetch(`${API_BASE}/marketplace/sellers/refresh`, { method: "POST", credentials: "include" }).then(() => load());
    }
  }, [load]);

  const startOnboarding = async () => {
    setBusy("onboard");
    try {
      const res = await fetch(`${API_BASE}/marketplace/sellers/onboard`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as { url: string };
      window.location.href = json.url;
    } catch (e) {
      alert((e as Error).message);
      setBusy(null);
    }
  };

  const openDashboard = async () => {
    setBusy("dashboard");
    try {
      const res = await fetch(`${API_BASE}/marketplace/sellers/dashboard`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as { url: string };
      window.location.href = json.url;
    } catch (e) {
      alert((e as Error).message);
      setBusy(null);
    }
  };

  const createDraft = async () => {
    const cents = Math.round(Number(priceDollars) * 100);
    if (!title.trim() || !description.trim() || !Number.isFinite(cents) || cents < 100) {
      alert("Fill in title, description, and a price ≥ $1.00.");
      return;
    }
    setBusy("create");
    try {
      const res = await fetch(`${API_BASE}/marketplace/listings`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim(), priceCents: cents, type: "report" }),
      });
      if (!res.ok) throw new Error(await res.text());
      setTitle(""); setDescription(""); setPriceDollars("");
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploadTargetId, setUploadTargetId] = useState<number | null>(null);
  const [uploadKind, setUploadKind] = useState<"file" | "preview-file">("file");

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadTargetId) return;
    setBusy(`${uploadKind}-${uploadTargetId}`);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_BASE}/marketplace/listings/${uploadTargetId}/${uploadKind}`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
      setUploadTargetId(null);
      setUploadKind("file");
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  const submitForReview = async (id: number) => {
    setBusy(`submit-${id}`);
    try {
      const res = await fetch(`${API_BASE}/marketplace/listings/${id}/submit`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const archive = async (id: number) => {
    if (!confirm("Archive this listing? It will be hidden from the marketplace.")) return;
    setBusy(`archive-${id}`);
    try {
      const res = await fetch(`${API_BASE}/marketplace/listings/${id}/archive`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const canPublish = seller && seller.chargesEnabled && seller.payoutsEnabled;

  if (!isLoaded) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
      <MobileNotice />
        <MarketplaceNav />
        <div className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
      </div>
    );
  }
  if (!user) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <MarketplaceNav />
        <div className="p-12 text-center text-muted-foreground">Sign in to sell research.</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
      <MarketplaceNav />
      <div>
        <h1 className="font-serif text-3xl flex items-center gap-2"><Store className="w-7 h-7 text-primary" /> Sell your research</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Publish reports and earn. We take 15% as a platform fee; you keep 85%. Payouts via Stripe.
        </p>
      </div>

      {/* Seller onboarding card */}
      <Card className="rounded-none">
        <CardHeader>
          <CardTitle className="text-base font-serif">1. Seller account</CardTitle>
          <CardDescription>Stripe Connect handles KYC, payouts, and 1099-K tax forms.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : !seller ? (
            <Button onClick={startOnboarding} disabled={busy === "onboard"} className="rounded-none">
              {busy === "onboard" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpRight className="w-4 h-4" />}
              <span className="ml-2">Start Stripe onboarding</span>
            </Button>
          ) : canPublish ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-emerald-700">
                <CheckCircle2 className="w-4 h-4" /> Verified and ready to receive payouts.
              </div>
              <Button variant="outline" onClick={openDashboard} disabled={busy === "dashboard"} className="rounded-none">
                {busy === "dashboard" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpRight className="w-4 h-4" />}
                <span className="ml-2">Open Stripe dashboard</span>
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-start gap-2 p-3 border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-950/30 text-sm">
                <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
                <span>Onboarding not complete. Finish Stripe verification to start selling.</span>
              </div>
              <Button onClick={startOnboarding} disabled={busy === "onboard"} className="rounded-none">
                {busy === "onboard" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpRight className="w-4 h-4" />}
                <span className="ml-2">Continue onboarding</span>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create listing */}
      <Card className="rounded-none">
        <CardHeader>
          <CardTitle className="text-base font-serif">2. Create a listing</CardTitle>
          <CardDescription>Save as draft, upload the PDF, then submit for admin review.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="ml-title">Title</Label>
            <Input id="ml-title" placeholder="Your report's title" value={title} onChange={e => setTitle(e.target.value)} className="rounded-none" />
          </div>
          <div>
            <Label htmlFor="ml-desc">Description</Label>
            <Textarea id="ml-desc" rows={5} placeholder="What's inside, who it's for, key findings..." value={description} onChange={e => setDescription(e.target.value)} className="rounded-none" />
          </div>
          <div className="flex gap-2 items-end">
            <div className="w-32">
              <Label htmlFor="ml-price">Price (USD)</Label>
              <Input id="ml-price" type="number" step="0.01" placeholder="49.00" value={priceDollars} onChange={e => setPriceDollars(e.target.value)} className="rounded-none font-mono" />
            </div>
            <Button onClick={createDraft} disabled={busy === "create"} className="rounded-none">
              {busy === "create" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              <span className="ml-2">Save draft</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* My listings */}
      <Card className="rounded-none">
        <CardHeader>
          <CardTitle className="text-base font-serif">3. Your listings</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {listings.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No listings yet.</div>
          ) : (
            <ul className="divide-y">
              {listings.map(l => (
                <li key={l.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                  <div className="flex-1">
                    <div className="font-medium flex items-center gap-2 flex-wrap">
                      {l.title} {statusBadge(l.status)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {fmtMoney(l.priceCents)}
                      {l.fileOriginalName ? ` · ${l.fileOriginalName}` : " · no file uploaded"}
                    </div>
                    {l.rejectionReason && (
                      <div className="text-xs text-red-700 mt-1">Admin feedback: {l.rejectionReason}</div>
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {(l.status === "draft" || l.status === "rejected" || l.status === "approved") && (
                      <>
                        {(l.status === "draft" || l.status === "rejected") && (
                          <Button size="sm" variant="outline" onClick={() => { setUploadKind("file"); setUploadTargetId(l.id); uploadRef.current?.click(); }} disabled={busy === `file-${l.id}`} className="h-8 rounded-none">
                            {busy === `file-${l.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                            <span className="ml-1">{l.fileKey ? "Replace PDF" : "Upload PDF"}</span>
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => { setUploadKind("preview-file"); setUploadTargetId(l.id); uploadRef.current?.click(); }} disabled={busy === `preview-file-${l.id}`} className="h-8 rounded-none" title="Optional free preview PDF — downloadable without purchase">
                          {busy === `preview-file-${l.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                          <span className="ml-1">{l.previewFileKey ? "Replace preview" : "Upload preview"}</span>
                        </Button>
                        {(l.status === "draft" || l.status === "rejected") && (
                          <Button size="sm" onClick={() => submitForReview(l.id)} disabled={!l.fileKey || busy === `submit-${l.id}`} className="h-8 rounded-none">
                            {busy === `submit-${l.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                            <span className="ml-1">Submit for review</span>
                          </Button>
                        )}
                      </>
                    )}
                    {(l.status === "approved" || l.status === "pending_review") && (
                      <Button size="sm" variant="outline" onClick={() => archive(l.id)} disabled={busy === `archive-${l.id}`} className="h-8 rounded-none">
                        {busy === `archive-${l.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                        <span className="ml-1">Archive</span>
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <input ref={uploadRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileChange} />
    </div>
  );
}
