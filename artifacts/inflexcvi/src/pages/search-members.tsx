/**
 * /search/members — find members by name, headline, industry, capability,
 * location. Multi-filter query with live result cards. Click through to
 * /member/:slug.
 */
import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Search, MapPin, Building2, Tag, Loader2, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";

interface SearchResult {
  userId: string; slug: string; displayName: string; headline: string | null;
  avatarUrl: string | null; location: string | null;
  industrySlugs: string[]; capabilityTags: string[];
}

export default function SearchMembersPage() {
  const [q, setQ] = useState("");
  const [industry, setIndustry] = useState("");
  const [capability, setCapability] = useState("");
  const [location, setLocation] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const runSearch = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (industry) params.set("industry", industry);
      if (capability) params.set("capability", capability);
      if (location) params.set("location", location);
      const r = await fetch(`/api/search/members?${params}`);
      if (r.ok) { const d = await r.json() as { results: SearchResult[] }; setResults(d.results); }
    } finally { setLoading(false); }
  }, [q, industry, capability, location]);

  useEffect(() => {
    const handle = setTimeout(() => { void runSearch(); }, 350);
    return () => clearTimeout(handle);
  }, [runSearch]);

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl space-y-6">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5" /> Home
      </Link>
      <PageHeader
        eyebrow="Search"
        title="Find members"
        descriptions={{
          default: "Search the member directory by name, headline, industry, capability expertise, or location. Click any result to open their profile.",
          pe: "Hunt for operators with industry-specific capability depth. Filter by sector + capability tag to surface the few members who actually know that node.",
          vc: "Track down founders and operators in your thesis areas. Capability + industry filters narrow it from 'name search' to 'thesis-relevant network'.",
          f500: "Find peers in your industry to benchmark with, or experts in capabilities you're below cohort on.",
          student: "Find professors, peers, and operators worth following or reaching out to.",
          professor: "Locate fellow educators or industry practitioners to build syllabi with.",
        }}
      />

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, headline, or bio…"
              value={q}
              onChange={e => setQ(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="grid sm:grid-cols-3 gap-2">
            <Input placeholder="Industry slug (e.g. banking)" value={industry} onChange={e => setIndustry(e.target.value)} />
            <Input placeholder="Capability tag" value={capability} onChange={e => setCapability(e.target.value)} />
            <Input placeholder="Location" value={location} onChange={e => setLocation(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Searching…</div>
      ) : results.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">
          {q || industry || capability || location ? "No members match those filters." : "Start typing to search the directory."}
        </CardContent></Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {results.map(r => (
            <Link key={r.userId} href={`/member/${r.slug}`} className="block">
              <Card className="hover:border-accent transition-colors cursor-pointer">
                <CardContent className="p-4 flex items-start gap-3">
                  {r.avatarUrl ? (
                    <img src={r.avatarUrl} alt="" className="w-12 h-12 rounded-full border border-border shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center font-medium shrink-0">{r.displayName.charAt(0).toUpperCase()}</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{r.displayName}</div>
                    {r.headline && <p className="text-xs text-muted-foreground truncate">{r.headline}</p>}
                    {r.location && (
                      <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1 mt-0.5">
                        <MapPin className="w-2.5 h-2.5" /> {r.location}
                      </div>
                    )}
                    {(r.industrySlugs.length > 0 || r.capabilityTags.length > 0) && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {r.industrySlugs.slice(0, 2).map(s => <Badge key={`i-${s}`} variant="outline" className="text-[10px] capitalize"><Building2 className="w-2.5 h-2.5 mr-0.5" />{s.replace(/-/g, " ")}</Badge>)}
                        {r.capabilityTags.slice(0, 2).map(t => <Badge key={`c-${t}`} variant="secondary" className="text-[10px]"><Tag className="w-2.5 h-2.5 mr-0.5" />{t}</Badge>)}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
