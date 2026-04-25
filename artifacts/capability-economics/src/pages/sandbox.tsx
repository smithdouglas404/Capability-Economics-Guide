import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { FlaskRound, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const API_BASE = "/api";

export default function SandboxPage() {
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function clone() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/sandbox/clone`, { method: "POST", credentials: "include" });
      if (!res.ok) {
        setError(`Clone failed (${res.status})`);
        return;
      }
      const data = await res.json();
      const token: string | undefined = data?.sessionToken;
      if (!token) { setError("No session token returned."); return; }
      try { localStorage.setItem("ce_session_token", token); } catch { /* storage may be unavailable */ }
      if (data?.organization?.industryId) {
        try { localStorage.setItem("ce_industry_id", String(data.organization.industryId)); } catch { /* ignore */ }
      }
      navigate("/dashboard");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Academic · Sandbox</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <FlaskRound className="w-8 h-8 text-primary" />
          Sandbox Org
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          The sandbox spins up a fresh "TeachCorp" organization seeded against the default industry so students can explore
          assessments, dashboards, and scoring without affecting any real data. Each clone has its own session token.
        </p>
      </motion.div>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg">Clone TeachCorp</CardTitle>
          <CardDescription>Creates a new sandbox organization and signs you into it for this browser.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={clone} disabled={busy} data-testid="sandbox-clone">
            {busy ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Cloning…</> : "Clone TeachCorp sandbox"}
          </Button>
          {error && <p className="text-sm text-rose-600 mt-3">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
