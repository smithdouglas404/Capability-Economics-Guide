/**
 * /member/:slug — public member profile page (LinkedIn-style).
 *
 * Move 7 of the strategic UX overhaul. Public read of the
 * member_profiles row + a "Message this member" button that opens
 * the inbox conversation thread with them.
 */
import { useEffect, useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { Globe, Linkedin, MessageCircle, Tag, Building2, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface MemberProfile {
  userId: string;
  slug: string;
  displayName: string;
  headline: string | null;
  bio: string | null;
  avatarUrl: string | null;
  websiteUrl: string | null;
  linkedinUrl: string | null;
  industrySlugs: string[];
  capabilityTags: string[];
  createdAt: string;
}

export default function MemberPage() {
  const params = useParams();
  const slug = params.slug;
  const { user, isSignedIn } = useUser();
  const [, setLocation] = useLocation();
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    fetch(`/api/member/${slug}`)
      .then(r => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.ok ? r.json() : null;
      })
      .then((data: { profile: MemberProfile } | null) => {
        if (data?.profile) setProfile(data.profile);
      })
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <div className="container mx-auto px-4 py-10 text-sm text-muted-foreground">Loading…</div>;
  if (notFound) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-2xl space-y-3">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5" /> Home
        </Link>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">No public profile for "{slug}".</CardContent>
        </Card>
      </div>
    );
  }
  if (!profile) return null;

  const isSelf = isSignedIn && user?.id === profile.userId;

  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl space-y-6">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5" /> Home
      </Link>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt={profile.displayName} className="w-20 h-20 rounded-full border border-border" />
            ) : (
              <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center font-serif text-2xl text-muted-foreground">
                {profile.displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="font-serif text-3xl tracking-tight">{profile.displayName}</h1>
              {profile.headline && <p className="text-base text-muted-foreground mt-1">{profile.headline}</p>}
              <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
                {profile.websiteUrl && (
                  <a href={profile.websiteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                    <Globe className="w-3 h-3" /> Website
                  </a>
                )}
                {profile.linkedinUrl && (
                  <a href={profile.linkedinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                    <Linkedin className="w-3 h-3" /> LinkedIn
                  </a>
                )}
                <span>Member since {new Date(profile.createdAt).toISOString().slice(0, 7)}</span>
              </div>
            </div>
            {!isSelf && isSignedIn && (
              <Button onClick={() => setLocation(`/inbox/${profile.userId}`)} size="sm">
                <MessageCircle className="w-4 h-4 mr-1" /> Message
              </Button>
            )}
            {isSelf && (
              <Button asChild variant="outline" size="sm"><Link href="/account/profile">Edit profile</Link></Button>
            )}
          </div>
        </CardContent>
      </Card>

      {profile.bio && (
        <Card>
          <CardContent className="p-6">
            <h2 className="font-serif text-lg tracking-tight mb-2">About</h2>
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/80">{profile.bio}</p>
          </CardContent>
        </Card>
      )}

      {(profile.industrySlugs.length > 0 || profile.capabilityTags.length > 0) && (
        <Card>
          <CardContent className="p-6 space-y-4">
            {profile.industrySlugs.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
                  <Building2 className="w-3 h-3" /> Industries
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {profile.industrySlugs.map(s => (
                    <Badge key={s} variant="outline" className="text-xs capitalize">{s.replace(/-/g, " ")}</Badge>
                  ))}
                </div>
              </div>
            )}
            {profile.capabilityTags.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
                  <Tag className="w-3 h-3" /> Capability expertise
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {profile.capabilityTags.map(t => (
                    <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
