import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tierName: string;
  tierSlug: string;
}

type Status = "idle" | "submitting" | "submitted" | "already" | "error";

export function PlatformSignupDialog({ open, onOpenChange, tierName, tierSlug }: Props) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [organization, setOrganization] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [serverMsg, setServerMsg] = useState<string | null>(null);

  const reset = () => {
    setEmail("");
    setName("");
    setOrganization("");
    setMessage("");
    setStatus("idle");
    setErrorMsg(null);
    setServerMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("submitting");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/platform-signup/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim(),
          organization: organization.trim(),
          message: message.trim() || null,
          tierSlug,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setErrorMsg(String(err.error ?? `Request failed (${res.status})`));
        setStatus("error");
        return;
      }
      const json = (await res.json()) as { ok: boolean; alreadyExists?: boolean; message?: string };
      if (json.alreadyExists) {
        setServerMsg(json.message ?? "We already have your request on file.");
        setStatus("already");
      } else {
        setStatus("submitted");
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
      setStatus("error");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl tracking-tight">
            Request access to {tierName}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
            {tierName} is offered through an approved-account flow. Submit this form and an
            admin will review your request. Once approved you'll receive a one-time link to
            finish creating your account using Google or another SSO provider. Identity verification
            still applies before checkout.
          </DialogDescription>
        </DialogHeader>

        {status === "submitted" ? (
          <div className="py-6 space-y-3">
            <p className="font-serif text-lg">Thanks — request received.</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              An admin will review your request and reach out at <strong>{email}</strong> with
              your signup link. You can close this window.
            </p>
            <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-none">
              Close
            </Button>
          </div>
        ) : status === "already" ? (
          <div className="py-6 space-y-3">
            <p className="font-serif text-lg">Already on file.</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {serverMsg ?? "We already have a request from this email."}
            </p>
            <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-none">
              Close
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="signup-email">Work email</Label>
              <Input
                id="signup-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="signup-name">Full name</Label>
                <Input
                  id="signup-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Doe"
                  autoComplete="name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signup-org">Organization</Label>
                <Input
                  id="signup-org"
                  required
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="Capital Partners LLC"
                  autoComplete="organization"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="signup-message">
                Anything we should know? <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="signup-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Use case, team size, timeline — anything that helps us approve quickly."
                rows={3}
              />
            </div>

            {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="rounded-none"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={status === "submitting"}
                className="rounded-none"
              >
                {status === "submitting" ? "Submitting…" : "Submit request"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
