/**
 * /account/profile — full profile editor.
 *
 * Sections: identity (avatar, cover, headline, bio, location, current role,
 * open-to status), links, expertise (industries + capability tags),
 * experience timeline, education timeline, skills.
 *
 * Standard CV-format edit surface. Visual language is our own (serif
 * headers, accent color, mono eyebrow labels, card-based stacks).
 */
import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import { useUser, SignInButton } from "@clerk/react";
import {
  Loader2, Save, ArrowLeft, ExternalLink, Plus, Trash2, Briefcase,
  GraduationCap, Award, Image as ImageIcon, Eye,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

interface Profile {
  userId: string;
  slug: string;
  displayName: string;
  headline: string | null;
  bio: string | null;
  avatarUrl: string | null;
  coverImageUrl: string | null;
  location: string | null;
  currentRole: string | null;
  openTo: string[];
  websiteUrl: string | null;
  linkedinUrl: string | null;
  industrySlugs: string[];
  capabilityTags: string[];
  publicVisibility: boolean;
}

interface Experience {
  id: number; company: string; title: string; location: string | null;
  employmentType: string | null; startDate: string; endDate: string | null;
  description: string | null;
}
interface Education {
  id: number; school: string; degree: string | null; field: string | null;
  startYear: number | null; endYear: number | null; activities: string | null;
}
interface Skill { id: number; name: string; endorsementCount: number; }

const OPEN_TO_OPTIONS = [
  { id: "hiring", label: "Hiring" },
  { id: "consulting", label: "Open to consulting" },
  { id: "investing", label: "Investing" },
  { id: "collaborating", label: "Open to collaborate" },
];

export default function AccountProfilePage() {
  const { isSignedIn, isLoaded } = useUser();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [experience, setExperience] = useState<Experience[]>([]);
  const [education, setEducation] = useState<Education[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);

  // New-entry inline forms
  const [showExpForm, setShowExpForm] = useState(false);
  const [showEduForm, setShowEduForm] = useState(false);
  const [newSkillName, setNewSkillName] = useState("");

  const refresh = useCallback(async () => {
    if (!isSignedIn) return;
    const meResp = await fetch("/api/me/profile");
    if (meResp.ok) {
      const d = await meResp.json() as { profile: Profile };
      setProfile(d.profile);
      const uid = d.profile.userId;
      const [e, ed, s] = await Promise.all([
        fetch(`/api/member/${uid}/experience`).then(r => r.ok ? r.json() : { experience: [] }),
        fetch(`/api/member/${uid}/education`).then(r => r.ok ? r.json() : { education: [] }),
        fetch(`/api/member/${uid}/skills`).then(r => r.ok ? r.json() : { skills: [] }),
      ]);
      setExperience(e.experience ?? []);
      setEducation(ed.education ?? []);
      setSkills(s.skills ?? []);
    }
  }, [isSignedIn]);

  useEffect(() => {
    if (!isSignedIn) { setLoading(false); return; }
    void refresh().finally(() => setLoading(false));
  }, [isSignedIn, refresh]);

  const updateField = <K extends keyof Profile>(k: K, v: Profile[K]): void => {
    setProfile(p => p ? { ...p, [k]: v } : p);
    setSaved(false);
  };

  const toggleOpenTo = (id: string): void => {
    if (!profile) return;
    const next = profile.openTo.includes(id) ? profile.openTo.filter(x => x !== id) : [...profile.openTo, id];
    updateField("openTo", next);
  };

  const save = async (): Promise<void> => {
    if (!profile) return;
    setSaving(true);
    try {
      const resp = await fetch("/api/me/profile", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: profile.displayName, headline: profile.headline ?? "",
          bio: profile.bio ?? "", avatarUrl: profile.avatarUrl ?? "",
          coverImageUrl: profile.coverImageUrl ?? "", location: profile.location ?? "",
          currentRole: profile.currentRole ?? "", openTo: profile.openTo,
          websiteUrl: profile.websiteUrl ?? "", linkedinUrl: profile.linkedinUrl ?? "",
          industrySlugs: profile.industrySlugs, capabilityTags: profile.capabilityTags,
          publicVisibility: profile.publicVisibility,
        }),
      });
      if (resp.ok) { const d = await resp.json() as { profile: Profile }; setProfile(d.profile); setSaved(true); }
    } finally { setSaving(false); }
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
    <div className="container mx-auto px-4 py-10 max-w-3xl space-y-6">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5" /> Home
      </Link>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-serif text-3xl tracking-tight">Your profile</h1>
          <p className="text-sm text-muted-foreground mt-1">
            How other members see you at{" "}
            <Link href={`/member/${profile.slug}`} className="text-accent hover:underline inline-flex items-center gap-1">
              /member/{profile.slug} <ExternalLink className="w-3 h-3" />
            </Link>
          </p>
        </div>
      </div>

      {/* Profile completion meter — counts populated profile fields + supporting
          sections. Drives the user to fill in the parts that move the needle. */}
      <ProfileCompletionMeter profile={profile} experienceCount={experience.length} educationCount={education.length} skillsCount={skills.length} />

      {/* IDENTITY */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Identity</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Avatar URL" icon={<ImageIcon className="w-3 h-3" />}>
              <Input value={profile.avatarUrl ?? ""} onChange={e => updateField("avatarUrl", e.target.value)} placeholder="https://…" />
            </Field>
            <Field label="Cover image URL" icon={<ImageIcon className="w-3 h-3" />}>
              <Input value={profile.coverImageUrl ?? ""} onChange={e => updateField("coverImageUrl", e.target.value)} placeholder="https://… (1584×396)" />
            </Field>
          </div>
          <Field label="Display name">
            <Input value={profile.displayName} onChange={e => updateField("displayName", e.target.value)} maxLength={200} />
          </Field>
          <Field label="Headline (one-line elevator pitch)">
            <Input value={profile.headline ?? ""} onChange={e => updateField("headline", e.target.value)} maxLength={280} placeholder="Capability strategist · ex-Bain · banking" />
          </Field>
          <Field label="Current role (specific — title at company)">
            <Input value={profile.currentRole ?? ""} onChange={e => updateField("currentRole", e.target.value)} maxLength={280} placeholder="VP Product at Acme · ex-Stripe" />
          </Field>
          <Field label="Location">
            <Input value={profile.location ?? ""} onChange={e => updateField("location", e.target.value)} maxLength={200} placeholder="San Francisco, CA · Remote" />
          </Field>
          <Field label="About (Markdown, ≤4000 chars)">
            <Textarea rows={6} value={profile.bio ?? ""} onChange={e => updateField("bio", e.target.value)} maxLength={4000} />
          </Field>
          <div>
            <div className="text-xs text-muted-foreground mb-1.5">Open to (status badges on your profile)</div>
            <div className="flex flex-wrap gap-1.5">
              {OPEN_TO_OPTIONS.map(o => (
                <button
                  key={o.id}
                  onClick={() => toggleOpenTo(o.id)}
                  className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${
                    profile.openTo.includes(o.id)
                      ? "bg-accent text-accent-foreground border-accent"
                      : "border-border/60 hover:border-accent"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* LINKS */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Links</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Field label="Website">
            <Input value={profile.websiteUrl ?? ""} onChange={e => updateField("websiteUrl", e.target.value)} placeholder="https://yourdomain.com" />
          </Field>
          <Field label="External profile URL">
            <Input value={profile.linkedinUrl ?? ""} onChange={e => updateField("linkedinUrl", e.target.value)} placeholder="https://…" />
          </Field>
        </CardContent>
      </Card>

      {/* EXPERTISE */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Expertise</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Field label="Industries (comma-separated slugs)">
            <Input
              value={profile.industrySlugs.join(", ")}
              onChange={e => updateField("industrySlugs", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
              placeholder="banking, insurance, healthcare"
            />
          </Field>
          <Field label="Capability expertise tags (comma-separated)">
            <Input
              value={profile.capabilityTags.join(", ")}
              onChange={e => updateField("capabilityTags", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
              placeholder="Customer Data Platform, Claims Automation"
            />
          </Field>
        </CardContent>
      </Card>

      {/* Capability watchlist (inline panel) */}
      <CapabilityWatchlistPanel />

      {/* Public visibility + Save */}
      <Card>
        <CardContent className="pt-5 flex items-center justify-between gap-3 flex-wrap">
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
            Save identity + links + expertise
          </Button>
        </CardContent>
      </Card>
      {saved && <div className="text-emerald-500 text-sm">Saved.</div>}

      {/* EXPERIENCE */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><Briefcase className="w-4 h-4" /> Experience</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowExpForm(o => !o)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> {showExpForm ? "Cancel" : "Add experience"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {showExpForm && <ExperienceForm onCreated={async () => { setShowExpForm(false); await refresh(); }} />}
          {experience.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No experience yet.</p>
          ) : (
            <div className="space-y-3">
              {experience.map(e => (
                <div key={e.id} className="flex items-start justify-between gap-2 p-3 border border-border/60 rounded-md">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{e.title} · {e.company}</div>
                    <div className="text-xs text-muted-foreground">{e.startDate} — {e.endDate ?? "Present"}{e.location ? ` · ${e.location}` : ""}</div>
                    {e.description && <p className="text-sm text-foreground/75 mt-1 whitespace-pre-wrap">{e.description}</p>}
                  </div>
                  <Button size="icon" variant="ghost" onClick={async () => { await fetch(`/api/me/experience/${e.id}`, { method: "DELETE" }); await refresh(); }}>
                    <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* EDUCATION */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><GraduationCap className="w-4 h-4" /> Education</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowEduForm(o => !o)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> {showEduForm ? "Cancel" : "Add education"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {showEduForm && <EducationForm onCreated={async () => { setShowEduForm(false); await refresh(); }} />}
          {education.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No education yet.</p>
          ) : (
            <div className="space-y-3">
              {education.map(e => (
                <div key={e.id} className="flex items-start justify-between gap-2 p-3 border border-border/60 rounded-md">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{e.school}</div>
                    <div className="text-xs text-muted-foreground">
                      {[e.degree, e.field].filter(Boolean).join(", ") || "—"}
                      {(e.startYear || e.endYear) ? ` · ${e.startYear ?? "—"}–${e.endYear ?? "—"}` : ""}
                    </div>
                    {e.activities && <p className="text-sm text-foreground/75 mt-1">{e.activities}</p>}
                  </div>
                  <Button size="icon" variant="ghost" onClick={async () => { await fetch(`/api/me/education/${e.id}`, { method: "DELETE" }); await refresh(); }}>
                    <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* SKILLS */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Award className="w-4 h-4" /> Skills</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={newSkillName}
              onChange={e => setNewSkillName(e.target.value)}
              placeholder="Add a skill (e.g. 'Customer Data Platform')"
              maxLength={100}
              onKeyDown={async e => {
                if (e.key === "Enter" && newSkillName.trim()) {
                  await fetch("/api/me/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newSkillName.trim() }) });
                  setNewSkillName("");
                  await refresh();
                }
              }}
            />
            <Button onClick={async () => {
              if (!newSkillName.trim()) return;
              await fetch("/api/me/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newSkillName.trim() }) });
              setNewSkillName("");
              await refresh();
            }}><Plus className="w-3.5 h-3.5 mr-1" /> Add</Button>
          </div>
          {skills.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No skills listed yet. Add one above — other members can endorse it.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {skills.map(s => (
                <span key={s.id} className="inline-flex items-center gap-1.5 px-2 py-1 border border-border/60 rounded-md text-sm">
                  {s.name}
                  <Badge variant="outline" className="text-[10px] py-0">{s.endorsementCount}</Badge>
                  <button onClick={async () => { await fetch(`/api/me/skills/${s.id}`, { method: "DELETE" }); await refresh(); }} className="text-muted-foreground hover:text-rose-500">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Profile completion meter — counts populated profile fields + supporting
 * sections. Each filled field adds one point to a max of 12. Drives the
 * user to fill in the high-impact sections by listing the next missing one.
 */
function ProfileCompletionMeter({
  profile, experienceCount, educationCount, skillsCount,
}: {
  profile: Profile; experienceCount: number; educationCount: number; skillsCount: number;
}) {
  const checks = [
    { key: "avatar", label: "Avatar image", done: !!profile.avatarUrl },
    { key: "cover", label: "Cover image", done: !!profile.coverImageUrl },
    { key: "headline", label: "Headline", done: !!profile.headline && profile.headline.length > 0 },
    { key: "currentRole", label: "Current role", done: !!profile.currentRole && profile.currentRole.length > 0 },
    { key: "location", label: "Location", done: !!profile.location && profile.location.length > 0 },
    { key: "bio", label: "About / bio (≥80 chars)", done: !!profile.bio && profile.bio.length >= 80 },
    { key: "links", label: "Website or external profile", done: !!(profile.websiteUrl || profile.linkedinUrl) },
    { key: "industries", label: "At least one industry", done: profile.industrySlugs.length > 0 },
    { key: "capabilities", label: "Capability tags", done: profile.capabilityTags.length > 0 },
    { key: "experience", label: "At least one experience entry", done: experienceCount > 0 },
    { key: "education", label: "At least one education entry", done: educationCount > 0 },
    { key: "skills", label: "At least three skills", done: skillsCount >= 3 },
  ];
  const total = checks.length;
  const done = checks.filter(c => c.done).length;
  const pct = Math.round((done / total) * 100);
  const nextMissing = checks.find(c => !c.done);
  const tone = pct >= 80 ? "text-emerald-500" : pct >= 50 ? "text-amber-500" : "text-rose-500";
  const bar = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Profile completion</div>
            <div className="font-serif text-2xl tabular-nums inline-flex items-baseline gap-2">
              <span className={tone}>{pct}%</span>
              <span className="text-xs text-muted-foreground">{done} of {total} sections</span>
            </div>
          </div>
          {nextMissing ? (
            <span className="text-xs text-muted-foreground">Next: <span className="text-foreground font-medium">{nextMissing.label}</span></span>
          ) : (
            <span className="text-xs text-emerald-500 font-medium">Complete</span>
          )}
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className={`h-full ${bar} transition-all`} style={{ width: `${pct}%` }} />
        </div>
        {pct < 100 && (
          <div className="grid sm:grid-cols-2 gap-1 mt-2">
            {checks.filter(c => !c.done).slice(0, 6).map(c => (
              <div key={c.key} className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                <span className="w-3 h-3 rounded-full border border-border/60" /> {c.label}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground mb-1 inline-flex items-center gap-1">
        {icon}<span>{label}</span>
      </label>
      {children}
    </div>
  );
}

function ExperienceForm({ onCreated }: { onCreated: () => void }) {
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [employmentType, setEmploymentType] = useState("full-time");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (): Promise<void> => {
    if (!company || !title || !startDate) return;
    setSubmitting(true);
    try {
      await fetch("/api/me/experience", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company, title, location, employmentType, startDate, endDate: endDate || null, description }) });
      onCreated();
    } finally { setSubmitting(false); }
  };
  return (
    <div className="p-3 border border-accent/30 rounded-md bg-accent/5 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Company" value={company} onChange={e => setCompany(e.target.value)} />
        <Input placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
        <Input placeholder="Location" value={location} onChange={e => setLocation(e.target.value)} />
        <select className="border rounded px-3 py-2 bg-background text-sm" value={employmentType} onChange={e => setEmploymentType(e.target.value)}>
          <option value="full-time">Full-time</option>
          <option value="contract">Contract</option>
          <option value="founder">Founder</option>
          <option value="advisor">Advisor</option>
          <option value="other">Other</option>
        </select>
        <Input placeholder="Start (YYYY-MM)" value={startDate} onChange={e => setStartDate(e.target.value)} />
        <Input placeholder="End (YYYY-MM, blank = current)" value={endDate} onChange={e => setEndDate(e.target.value)} />
      </div>
      <Textarea rows={3} placeholder="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} />
      <Button size="sm" onClick={submit} disabled={submitting || !company || !title || !startDate}>
        {submitting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null} Add experience
      </Button>
    </div>
  );
}

/**
 * Inline watchlist panel — lists capabilities the user is watching with the
 * current threshold value (which doubles as a live score readout) and a
 * remove button. Stays in sync with /watchlist (the full-featured page) but
 * lives in-profile so users can prune watched items without leaving.
 */
interface WatchlistItem {
  id: number;
  capabilityId: number;
  capabilityName: string | null;
  thresholdType: string;
  thresholdValue: number;
  currentValue: number | null;
  triggered: boolean;
}

function CapabilityWatchlistPanel() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const sessionToken = typeof window !== "undefined" ? localStorage.getItem("ce_session_token") ?? "" : "";

  const load = useCallback(async (): Promise<void> => {
    if (!sessionToken) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/watchlist?sessionToken=${encodeURIComponent(sessionToken)}`);
      if (res.ok) {
        const d = await res.json() as { items: WatchlistItem[] };
        setItems(d.items ?? []);
      }
    } finally { setLoading(false); }
  }, [sessionToken]);

  useEffect(() => { void load(); }, [load]);

  const remove = async (id: number): Promise<void> => {
    await fetch(`/api/watchlist/items/${id}?sessionToken=${encodeURIComponent(sessionToken)}`, { method: "DELETE" });
    setItems(prev => prev.filter(i => i.id !== id));
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Eye className="w-4 h-4" /> Your capability watchlist
          {items.length > 0 && <Badge variant="outline" className="text-[10px] font-mono">{items.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!sessionToken ? (
          <p className="text-sm text-muted-foreground italic">Create an organization first to start watching capabilities.</p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground italic">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No watched capabilities yet. <Link href="/watchlist" className="text-accent hover:underline">Add some</Link> to get alerts when scores cross thresholds.
          </p>
        ) : (
          <div className="space-y-2">
            {items.map(i => (
              <div key={i.id} className="flex items-center justify-between gap-3 p-2.5 border border-border/60 rounded-md">
                <div className="min-w-0 flex-1">
                  <Link href={`/capability/${i.capabilityId}`} className="text-sm font-medium hover:text-accent truncate block">
                    {i.capabilityName ?? `Capability #${i.capabilityId}`}
                  </Link>
                  <div className="text-[11px] text-muted-foreground font-mono mt-0.5 flex items-center gap-2">
                    <span>{i.thresholdType.replace(/_/g, " ")} @ {i.thresholdValue}</span>
                    {i.currentValue != null && (
                      <span className={i.triggered ? "text-rose-500" : "text-foreground/70"}>
                        · now {i.currentValue.toFixed(1)}
                      </span>
                    )}
                  </div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => remove(i.id)} aria-label="Remove from watchlist">
                  <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                </Button>
              </div>
            ))}
            <Link href="/watchlist" className="text-xs text-accent hover:underline inline-flex items-center gap-1 mt-1">
              Manage all <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EducationForm({ onCreated }: { onCreated: () => void }) {
  const [school, setSchool] = useState("");
  const [degree, setDegree] = useState("");
  const [field, setField] = useState("");
  const [startYear, setStartYear] = useState("");
  const [endYear, setEndYear] = useState("");
  const [activities, setActivities] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (): Promise<void> => {
    if (!school) return;
    setSubmitting(true);
    try {
      await fetch("/api/me/education", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ school, degree, field, startYear: Number(startYear) || null, endYear: Number(endYear) || null, activities }) });
      onCreated();
    } finally { setSubmitting(false); }
  };
  return (
    <div className="p-3 border border-accent/30 rounded-md bg-accent/5 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="School" value={school} onChange={e => setSchool(e.target.value)} />
        <Input placeholder="Degree" value={degree} onChange={e => setDegree(e.target.value)} />
        <Input placeholder="Field of study" value={field} onChange={e => setField(e.target.value)} />
        <Input placeholder="Start year" value={startYear} onChange={e => setStartYear(e.target.value)} />
        <Input placeholder="End year" value={endYear} onChange={e => setEndYear(e.target.value)} />
      </div>
      <Textarea rows={2} placeholder="Activities / honors (optional)" value={activities} onChange={e => setActivities(e.target.value)} />
      <Button size="sm" onClick={submit} disabled={submitting || !school}>
        {submitting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null} Add education
      </Button>
    </div>
  );
}
