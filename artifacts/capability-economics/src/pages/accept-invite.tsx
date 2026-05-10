import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useUser, SignInButton } from "@clerk/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Loader2, UserPlus } from "lucide-react";

import { MobileNotice } from "@/components/mobile";
const API_BASE = "/api";

export default function AcceptInvitePage() {
  const [location, setLocation] = useLocation();
  const { isLoaded, isSignedIn } = useUser();
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");
  const [orgId, setOrgId] = useState<number | null>(null);

  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const accept = async () => {
    if (!token) { setStatus("error"); setMessage("No invite token in the URL."); return; }
    setStatus("loading");
    try {
      const res = await fetch(`${API_BASE}/billing-orgs/accept-invite`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as { orgId: number };
      setOrgId(json.orgId);
      setStatus("ok");
    } catch (e) {
      setStatus("error");
      setMessage((e as Error).message);
    }
  };

  // Auto-accept once the user is signed in
  useEffect(() => {
    if (isLoaded && isSignedIn && token && status === "idle") {
      void accept();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, token]);

  return (
    <div className="container mx-auto max-w-lg py-16 px-4">
      <MobileNotice />
      <Card className="rounded-none">
        <CardHeader>
          <CardTitle className="font-serif text-2xl flex items-center gap-2">
            <UserPlus className="w-6 h-6 text-primary" />
            Accept team invite
          </CardTitle>
          <CardDescription>
            You've been invited to join a team on Capability Economics.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!token && (
            <p className="text-sm text-muted-foreground">This invite link is missing a token.</p>
          )}
          {token && !isLoaded && <Loader2 className="w-5 h-5 animate-spin" />}
          {token && isLoaded && !isSignedIn && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Sign in or create an account to accept this invite.</p>
              <SignInButton mode="modal" forceRedirectUrl={location}>
                <Button className="rounded-none">Sign in to accept</Button>
              </SignInButton>
            </div>
          )}
          {status === "loading" && (
            <div className="flex items-center gap-2 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Accepting invite...</div>
          )}
          {status === "ok" && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 border-l-4 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <span>You've joined the team. Your access now reflects the team's tier.</span>
              </div>
              <Button onClick={() => setLocation(orgId ? `/account` : "/")} className="rounded-none">Continue</Button>
            </div>
          )}
          {status === "error" && (
            <div className="flex items-start gap-2 p-3 border-l-4 border-red-500 bg-red-50 dark:bg-red-950/30 text-sm">
              <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
              <span>{message || "Failed to accept invite."}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
