import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { GraduationCap, Loader2, ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const API_BASE = "/api";

type PackSummary = {
  id: number;
  slug: string;
  title: string;
  subtitle: string;
  industrySlug: string;
  level: "undergrad" | "mba" | "executive";
  durationWeeks: number;
  publishedAt: string;
};

const LEVEL_LABEL: Record<PackSummary["level"], string> = {
  undergrad: "Undergrad",
  mba: "MBA",
  executive: "Executive",
};

function industryLabel(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

export default function CurriculumPage() {
  const [packs, setPacks] = useState<PackSummary[] | null>(null);
  const [industryFilter, setIndustryFilter] = useState<string>("all");
  const [levelFilter, setLevelFilter] = useState<string>("all");

  useEffect(() => {
    fetch(`${API_BASE}/curriculum`)
      .then((r) => r.json())
      .then((j: { packs: PackSummary[] }) => setPacks(j.packs ?? []))
      .catch(() => setPacks([]));
  }, []);

  const industries = useMemo(() => {
    if (!packs) return [];
    const set = new Set(packs.map((p) => p.industrySlug));
    return Array.from(set).sort();
  }, [packs]);

  const filtered = useMemo(() => {
    if (!packs) return [];
    return packs.filter((p) => {
      if (industryFilter !== "all" && p.industrySlug !== industryFilter) return false;
      if (levelFilter !== "all" && p.level !== levelFilter) return false;
      return true;
    });
  }, [packs, industryFilter, levelFilter]);

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Academic · Curriculum</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <GraduationCap className="w-8 h-8 text-primary" />
          Curriculum Packs
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Ready-to-teach modules using live capability data.
        </p>
      </motion.div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="min-w-[180px]">
          <Select value={industryFilter} onValueChange={setIndustryFilter}>
            <SelectTrigger><SelectValue placeholder="Industry" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All industries</SelectItem>
              {industries.map((i) => (
                <SelectItem key={i} value={i}>{industryLabel(i)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[180px]">
          <Select value={levelFilter} onValueChange={setLevelFilter}>
            <SelectTrigger><SelectValue placeholder="Level" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              <SelectItem value="undergrad">Undergrad</SelectItem>
              <SelectItem value="mba">MBA</SelectItem>
              <SelectItem value="executive">Executive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <span className="text-xs text-muted-foreground ml-auto">
          {industryFilter !== "all" || levelFilter !== "all"
            ? `Showing ${filtered.length} of ${packs?.length ?? 0} ${(packs?.length ?? 0) === 1 ? "pack" : "packs"}`
            : `${filtered.length} ${filtered.length === 1 ? "pack" : "packs"}`}
        </span>
      </div>

      {packs === null ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <GraduationCap className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-sm">No curriculum packs match the current filters.</p>
          </CardContent>
        </Card>
      ) : (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.1 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
        >
          {filtered.map((pack, i) => (
            <motion.div
              key={pack.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.04 }}
            >
              <Card className="h-full flex flex-col">
                <CardHeader>
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <Badge variant="outline">{industryLabel(pack.industrySlug)}</Badge>
                    <Badge variant="secondary">{LEVEL_LABEL[pack.level]}</Badge>
                    <Badge variant="outline">
                      {pack.durationWeeks} {pack.durationWeeks === 1 ? "week" : "weeks"}
                    </Badge>
                  </div>
                  <CardTitle className="font-serif text-xl leading-tight">{pack.title}</CardTitle>
                  <CardDescription className="leading-relaxed">{pack.subtitle}</CardDescription>
                </CardHeader>
                <CardContent className="mt-auto">
                  <Link href={`/curriculum/${pack.slug}`}>
                    <Button variant="outline" size="sm" className="w-full">
                      Open pack <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
