import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bell, Plus, Trash2, Check, AlertTriangle, Shield, Clock, Eye, RefreshCw } from "lucide-react";

const API_BASE = "/api";

type WatchlistItem = {
  id: number;
  capabilityId: number;
  capabilityName: string;
  industryId: number;
  thresholdType: string;
  thresholdValue: number;
  currentValue: number | null;
  triggered: boolean;
  triggeredAt: string | null;
  notificationChannel: string;
};

type Alert = {
  id: number;
  watchlistItemId: number;
  message: string;
  previousValue: number | null;
  currentValue: number | null;
  acknowledged: boolean;
  createdAt: string;
};

type Capability = { id: number; name: string; industryId: number };

const THRESHOLD_TYPES = [
  { value: "half_life_below", label: "Half-life drops below", unit: "months" },
  { value: "fragility_above", label: "Fragility rises above", unit: "/100" },
  { value: "moat_below", label: "Moat drops below", unit: "/100" },
  { value: "score_below", label: "Score drops below", unit: "/100" },
  { value: "evar_above", label: "EVaR exceeds", unit: "$M" },
];

export default function Watchlist() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newCapId, setNewCapId] = useState<number>(0);
  const [newType, setNewType] = useState("half_life_below");
  const [newThreshold, setNewThreshold] = useState("18");
  const [checking, setChecking] = useState(false);
  const sessionToken = localStorage.getItem("ce_session_token") ?? "";

  const load = async () => {
    try {
      const [wRes, cRes] = await Promise.all([
        fetch(`${API_BASE}/watchlist?sessionToken=${sessionToken}`),
        fetch(`${API_BASE}/capabilities`),
      ]);
      const wData = await wRes.json();
      setItems(wData.items ?? []);
      setAlerts(wData.alerts ?? []);
      const caps = await cRes.json();
      setCapabilities(caps);
      if (caps.length && !newCapId) setNewCapId(caps[0].id);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { load(); }, []);

  const addItem = async () => {
    const cap = capabilities.find((c) => c.id === newCapId);
    if (!cap) return;
    await fetch(`${API_BASE}/watchlist/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken, capabilityId: newCapId, industryId: cap.industryId, thresholdType: newType, thresholdValue: Number(newThreshold) }),
    });
    setShowAdd(false);
    await load();
  };

  const removeItem = async (id: number) => {
    await fetch(`${API_BASE}/watchlist/items/${id}`, { method: "DELETE" });
    await load();
  };

  const ackAlert = async (id: number) => {
    await fetch(`${API_BASE}/watchlist/alerts/${id}/ack`, { method: "POST" });
    setAlerts((prev) => prev.map((a) => a.id === id ? { ...a, acknowledged: true } : a));
  };

  const checkNow = async () => {
    setChecking(true);
    try {
      await fetch(`${API_BASE}/watchlist/check`, { method: "POST" });
      await load();
    } catch (err) { console.error(err); }
    setChecking(false);
  };

  const unacknowledged = alerts.filter((a) => !a.acknowledged);
  const triggeredItems = items.filter((i) => i.triggered);

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-destructive" />
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Early Warning</span>
          </div>
          <h1 className="text-3xl font-serif tracking-tight">Capability Watchlist</h1>
          <p className="text-muted-foreground text-sm mt-1">Set thresholds on capabilities and get alerts when they cross critical levels.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={checkNow} disabled={checking} variant="outline">
            <RefreshCw className={`w-4 h-4 mr-2 ${checking ? "animate-spin" : ""}`} /> Check Now
          </Button>
          <Button onClick={() => setShowAdd(!showAdd)}><Plus className="w-4 h-4 mr-2" /> Add Watch</Button>
        </div>
      </div>

      {/* Unacknowledged Alerts */}
      {unacknowledged.length > 0 && (
        <div className="space-y-2">
          {unacknowledged.map((a) => (
            <div key={a.id} className="flex items-center gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
              <Bell className="w-5 h-5 text-destructive shrink-0 animate-pulse" />
              <div className="flex-1">
                <p className="text-sm font-medium">{a.message}</p>
                <p className="text-xs text-muted-foreground">
                  {a.previousValue !== null && `Previous: ${a.previousValue.toFixed(1)} → `}Current: {a.currentValue?.toFixed(1)} • {new Date(a.createdAt).toLocaleString()}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => ackAlert(a.id)}><Check className="w-4 h-4" /></Button>
            </div>
          ))}
        </div>
      )}

      {/* Add Form */}
      {showAdd && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <label className="text-sm font-medium">Capability</label>
                <select className="w-full border rounded px-3 py-2 bg-background text-sm" value={newCapId} onChange={(e) => setNewCapId(Number(e.target.value))}>
                  {capabilities.filter((c) => (c as any).isLeaf !== false).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="min-w-[200px]">
                <label className="text-sm font-medium">Alert When</label>
                <select className="w-full border rounded px-3 py-2 bg-background text-sm" value={newType} onChange={(e) => setNewType(e.target.value)}>
                  {THRESHOLD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label} ({t.unit})</option>
                  ))}
                </select>
              </div>
              <div className="w-[120px]">
                <label className="text-sm font-medium">Threshold</label>
                <Input type="number" value={newThreshold} onChange={(e) => setNewThreshold(e.target.value)} />
              </div>
              <Button onClick={addItem}>Add</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <Eye className="w-6 h-6 mx-auto mb-2 text-primary" />
            <p className="text-2xl font-bold">{items.length}</p>
            <p className="text-xs text-muted-foreground">Watched</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-destructive" />
            <p className="text-2xl font-bold">{triggeredItems.length}</p>
            <p className="text-xs text-muted-foreground">Triggered</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <Bell className="w-6 h-6 mx-auto mb-2 text-amber-500" />
            <p className="text-2xl font-bold">{unacknowledged.length}</p>
            <p className="text-xs text-muted-foreground">Unread Alerts</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <Shield className="w-6 h-6 mx-auto mb-2 text-emerald-500" />
            <p className="text-2xl font-bold">{items.length - triggeredItems.length}</p>
            <p className="text-xs text-muted-foreground">Within Threshold</p>
          </CardContent>
        </Card>
      </div>

      {/* Watched Items */}
      <Card>
        <CardHeader><CardTitle>Watched Capabilities</CardTitle></CardHeader>
        <CardContent>
          {items.length > 0 ? (
            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.id} className={`flex items-center justify-between p-3 rounded-lg border ${item.triggered ? "border-destructive/50 bg-destructive/5" : ""}`}>
                  <div>
                    <span className="font-medium text-sm">{item.capabilityName}</span>
                    <p className="text-xs text-muted-foreground">
                      {THRESHOLD_TYPES.find((t) => t.value === item.thresholdType)?.label ?? item.thresholdType}: {item.thresholdValue}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {item.currentValue !== null && (
                      <span className={`text-sm font-mono ${item.triggered ? "text-destructive font-bold" : ""}`}>
                        {item.currentValue.toFixed(1)}
                      </span>
                    )}
                    {item.triggered && <Badge variant="destructive" className="text-xs">Triggered</Badge>}
                    <Button size="sm" variant="ghost" onClick={() => removeItem(item.id)}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">No capabilities watched yet. Click "Add Watch" to start monitoring.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
