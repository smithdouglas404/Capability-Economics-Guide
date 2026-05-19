/**
 * /account/profile — edit your member profile.
 *
 * Move 7 of the strategic UX overhaul. Reads from /api/me/profile (which
 * lazy-creates a default row from your Clerk user). Saves via PATCH.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useUser, SignInButton } from "@clerk/react";
import { Loader2, Save, ArrowLeft, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface Profile {
  userId: string;
  slug: string;
  displayName: string;
  headline: string | null;
  bio: string | null;
  websiteUrl: string | null;
  linkedinUrl: string | null;
  industrySlugs: string[];
  capabilityTags: string[];
  publicVisibility: boolean;
}

export default function AccountProfilePage() {
  const { isSignedIn, isLoaded } = useUser();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!isSignedIn) { setLoading(false); return; }
    fetch("/api/me/profile")
      .then(r => r.ok ? r.json() : null)
      .then((d: { profile: Profile } | null) => { if (d?.profile) setProfile(d.profile); })
      .finally(() => setLoading(false));
  }, [isSignedIn]);

  const updateField = <K extends keyof Profile>(k: K, v: Profile[K]): void => {
    setProfile(p => p ? { ...p, [k]: v } : p);
    setSaved(false);
  };

  const save = async (): Promise<void> => {
    if (!profile) return;
    setSaving(true);
    try {
      const resp = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: profile.displayName,
          headline: profile.headline ?? "",
          bio: profile.bio ?? "",
          websiteUrl: profile.websiteUrl ?? "",
          linkedinUrl: profile.linkedinUrl ?? "",
          industrySlugs: profile.industrySlugs,
          capabilityTags: profile.capabilityTags,
          publicVisibility: profile.publicVisibility,
        }),
      });
      if (resp.ok) {
        const d = await resp.json() as { profile: Profile };
        setProfile(d.profile);
        setSaved(true);
      }
    } finally {
      setSaving(false);
    }
  };

  if (!isLoaded || loading) return <div className="container mx-auto px-4 py-10 text-sm text-muted-foreground">Loading…</div>;
  if (!isSignedIn) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-md">
        <Card><CardContent className="py-10 text-center space-y-3">
          <h3 className="font-serif text-xl">Sign in to edit your profile</h3>
          <SignInButton mode="modal"><Button>Sign in</Button></SignInButton>
        </CardContent></Card>
      </div>
    );
  }
  if (!profile) return null;

  return (
    <div className="container mx-auto px-4 py-10 max-w-2xl space-y-6">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5" /> Home
      </Link>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-serif text-3xl tracking-tight">Your profile</h1>
          <p className="text-sm text-muted-foreground mt-1">
            How other members see you. Your public profile lives at{" "}
            <Link href={`/member/${profile.slug}`} className="text-accent hover:underline inline-flex items-center gap-1">
              /member/{profile.slug}
              <ExternalLink className="w-3 h-3" />
            </Link>
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Identity</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Display name</label>
            <Input value={profile.displayName} onChange={e => updateField("displayName", e.target.value)} maxLength={200} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Headline (one line)</label>
            <Input value={profile.headline ?? ""} onChange={e => updateField("headline", e.target.value)} maxLength={280} placeholder="Capability strategist · ex-Bain · banking" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Bio (Markdown OK, up to 4000 chars)</label>
            <Textarea rows={6} value={profile.bio ?? ""} onChange={e => updateField("bio", e.target.value)} maxLength={4000} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Links</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Website</label>
            <Input value={profile.websiteUrl ?? ""} onChange={e => updateField("websiteUrl", e.target.value)} placeholder="https://yourdomain.com" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">LinkedIn URL</label>
            <Input value={profile.linkedinUrl ?? ""} onChange={e => updateField("linkedinUrl", e.target.value)} placeholder="https://linkedin.com/in/yourname" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Expertise</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Industries (comma-separated slugs, e.g. banking, insurance)</label>
            <Input
              value={profile.industrySlugs.join(", ")}
              onChange={e => updateField("industrySlugs", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Capability expertise tags (comma-separated)</label>
            <Input
              value={profile.capabilityTags.join(", ")}
              onChange={e => updateField("capabilityTags", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
              placeholder="Customer Data Platform, Claims Automation, …"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5 flex items-center justify-between gap-3">
          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={profile.publicVisibility}
              onChange={e => updateField("publicVisibility", e.target.checked)}
            />
            <span>Show my profile publicly at /member/{profile.slug}</span>
          </label>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save
          </Button>
        </CardContent>
      </Card>
      {saved && <div className="text-emerald-500 text-sm">Saved.</div>}
    </div>
  );
}
