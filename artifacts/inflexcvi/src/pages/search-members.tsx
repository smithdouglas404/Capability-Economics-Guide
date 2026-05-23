/**
 * /search/members — find members by name, headline, industry, capability,
 * location.
 *
 * Capability-aware overlay added in the social wave: when a capability slug
 * is set (either typed into the capability filter or arrived via ?capability=
 * deep-link) the page switches to *expert mode* — results come from
 * /api/social/experts-by-capability, are ranked by an expert score (3×posts
 * tagged + 2×forum threads tagged + 1×declared expertise), and each card
 * surfaces the per-member activity volume that earned the score.
 *
 * Without a capability filter, the standard directory search (name /
 * headline / industry / location) is used.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useSearch } from "wouter";
import { Search, MapPin, Building2, Tag, Loader2, ArrowLeft, Award, MessageSquare, MessageCircle, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";

interface SearchResult {
  userId: string; slug: string; displayName: string; headline: string | null;
  avatarUrl: string | null; location: string | null;
  industrySlugs: string[]; capabilityTags: string[];
}

interface ExpertResult extends SearchResult {
  postCount: number;
  forumCount: number;
  profileMatch: boolean;
  expertScore: number;
}

interface CapabilityLookup { id: number; slug: string; name: string }

export default function SearchMembersPage() {
  const search = useSearch();
  const deepLinkCap = useMemo(() => {
    try {
      const p = new URLSearchParams(search);
      return p.get("capability") ?? "";
    } catch { return ""; }
  }, [search]);

  const [q, setQ] = useState("");
  const [industry, setIndustry] = useState("");
  const [capability, setCapability] = useState(deepLinkCap);
  const [locationFilter, setLocationFilter] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [experts, setExperts] = useState<ExpertResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [capabilities, setCapabilities] = useState<CapabilityLookup[]>([]);

  // Sync deep-linked ?capability= once on mount.
  useEffect(() => { if (deepLinkCap) setCapability(deepLinkCap); }, [deepLinkCap]);

  // Load the capability catalog once so the chip-row can offer popular cap slugs.
  useEffect(() => {
    void fetch("/api/social/capabilities-lookup").then(r => r.ok ? r.json() : null).then((d: { capabilities: CapabilityLookup[] } | null) => {
      if (d?.capabilities) setCapabilities(d.capabilities);
    });
  }, []);

  // Expert mode is active when there's a capability filter. We still feed
  // through to /api/search/members for free-form name/industry/location
  // searches when there is no capability filter.
  const expertMode = capability.trim().length > 0;

  const runSearch = useCallback(async () => {
    setLoading(true);
    try {
      if (expertMode) {
        const r = await fetch(`/api/social/experts-by-capability?capability=${encodeURIComponent(capability.trim())}`);
        if (r.ok) {
          const d = await r.json() as { experts: ExpertResult[] };
          // Optional client-side narrowing on q / industry / location.
          const ql = q.trim().toLowerCase();
          const il = industry.trim().toLowerCase();
          const ll = locationFilter.trim().toLowerCase();
          const filtered = (d.experts ?? []).filter(e => {
            if (ql && !`${e.displayName} ${e.headline ?? ""}`.toLowerCase().includes(ql)) return false;
            if (il && !(e.industrySlugs ?? []).some(s => s.toLowerCase().includes(il))) return false;
            if (ll && !(e.location ?? "").toLowerCase().includes(ll)) return false;
            return true;
          });
          setExperts(filtered);
          setResults([]);
        }
      } else {
        const params = new URLSearchParams();
        if (q) params.set("q", q);
        if (industry) params.set("industry", industry);
        if (locationFilter) params.set("location", locationFilter);
        const r = await fetch(`/api/search/members?${params}`);
        if (r.ok) {
          const d = await r.json() as { results: SearchResult[] };
          setResults(d.results ?? []);
          setExperts([]);
        }
      }
    } finally { setLoading(false); }
  }, [q, industry, capability, locationFilter, expertMode]);

  useEffect(() => {
    const handle = setTimeout(() => { void runSearch(); }, 350);
    return () => clearTimeout(handle);
  }, [runSearch]);

  // Top 8 capabilities (alphabetical) for the chip row — keeps the UI honest
  // about which cap slugs actually exist.
  const popularCaps = useMemo(
    () => capabilities.slice(0, 80).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8),
    [capabilities],
  );

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl space-y-6">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5" /> Home
      </Link>
      <PageHeader
        eyebrow="Search"
        title="Find members"
        descriptions={{
          default: "Search the directory by name, headline, industry, capability expertise, or location. Type a capability to switch into expert mode — members are ranked by an expert score built from their posts and forum threads.",
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
            <Input placeholder="Capability slug (switches to expert mode)" value={capability} onChange={e => setCapability(e.target.value)} />
            <Input placeholder="Location" value={locationFilter} onChange={e => setLocationFilter(e.target.value)} />
          </div>
          {popularCaps.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Quick capabilities:</span>
              {popularCaps.map(c => (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => setCapability(c.slug)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                    capability === c.slug
                      ? "bg-accent/15 text-accent border-accent/40"
                      : "border-border/60 text-muted-foreground hover:border-accent/40 hover:text-foreground"
                  }`}
                >
                  {c.name}
                </button>
              ))}
              {capability && (
                <button
                  type="button"
                  onClick={() => setCapability("")}
                  className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
                >
                  clear
                </button>
              )}
            </div>
          )}
          {expertMode && (
            <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5 pt-1">
              <Award className="w-3 h-3 text-accent" />
              <span>Expert mode — ranking by activity volume on <span className="font-medium text-foreground">{capability}</span>.</span>
            </div>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Searching…</div>
      ) : expertMode ? (
        experts.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">
            No members have meaningful activity on <span className="font-medium text-foreground">{capability}</span> yet. Try a different capability or remove the filter.
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {experts.map((e, idx) => (
              <Link key={e.userId} href={`/member/${e.slug}`} className="block">
                <Card className="hover:border-accent transition-colors cursor-pointer">
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className="flex flex-col items-center gap-1 shrink-0 pt-1 w-9">
                      <div className="font-serif text-xl tracking-tight">{idx + 1}</div>
                      <div className="text-[9px] font-mono text-muted-foreground uppercase">rank</div>
                    </div>
                    {e.avatarUrl ? (
                      <img src={e.avatarUrl} alt="" className="w-12 h-12 rounded-full border border-border shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center font-medium shrink-0">{e.displayName.charAt(0).toUpperCase()}</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{e.displayName}</span>
                        <Badge className="text-[10px] bg-accent text-accent-foreground">
                          <Award className="w-2.5 h-2.5 mr-0.5" /> Score {e.expertScore}
                        </Badge>
                        {e.profileMatch && <Badge variant="outline" className="text-[10px]">Declared expert</Badge>}
                      </div>
                      {e.headline && <p className="text-xs text-muted-foreground truncate">{e.headline}</p>}
                      <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11px] text-muted-foreground">
                        {e.postCount > 0 && (
                          <span className="inline-flex items-center gap-1"><MessageSquare className="w-3 h-3" /> {e.postCount} post{e.postCount === 1 ? "" : "s"}</span>
                        )}
                        {e.forumCount > 0 && (
                          <span className="inline-flex items-center gap-1"><MessageCircle className="w-3 h-3" /> {e.forumCount} forum thread{e.forumCount === 1 ? "" : "s"}</span>
                        )}
                        {e.location && (
                          <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {e.location}</span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-2" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )
      ) : results.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">
          {q || industry || locationFilter ? "No members match those filters." : "Start typing to search the directory, or pick a capability above to find experts."}
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
                        {r.capabilityTags.slice(0, 2).map(t => (
                          <button
                            key={`c-${t}`}
                            type="button"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCapability(t); }}
                            className="text-[10px] inline-flex items-center"
                          >
                            <Badge variant="secondary" className="text-[10px]"><Tag className="w-2.5 h-2.5 mr-0.5" />{t}</Badge>
                          </button>
                        ))}
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
