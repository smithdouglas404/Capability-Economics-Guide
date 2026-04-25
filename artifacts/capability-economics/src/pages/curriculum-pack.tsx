import { useEffect, useState } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { motion } from "framer-motion";
import { GraduationCap, Loader2, ArrowLeft, Printer, FlaskConical, Download, ExternalLink } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const API_BASE = "/api";

type Pack = {
  id: number;
  slug: string;
  title: string;
  subtitle: string;
  industrySlug: string;
  level: "undergrad" | "mba" | "executive";
  durationWeeks: number;
  learningObjectives: string[];
  caseStudyMarkdown: string;
  assignmentPrompts: { title: string; prompt: string; deliverable: string }[];
  rubricMarkdown: string | null;
  datasetExportUrls: { label: string; url: string }[];
  sourceCitations: { title: string; url: string }[];
  publishedAt: string;
  updatedAt: string;
};

const LEVEL_LABEL: Record<Pack["level"], string> = {
  undergrad: "Undergrad",
  mba: "MBA",
  executive: "Executive",
};

function industryLabel(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

export default function CurriculumPackPage() {
  const [, params] = useRoute("/curriculum/:slug");
  const [, navigate] = useLocation();
  const slug = params?.slug;
  const [pack, setPack] = useState<Pack | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [cloning, setCloning] = useState(false);

  useEffect(() => {
    if (!slug) return;
    fetch(`${API_BASE}/curriculum/${slug}`)
      .then(async (r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        const j = await r.json();
        return j.pack as Pack;
      })
      .then((p) => { if (p) setPack(p); })
      .catch(() => setNotFound(true));
  }, [slug]);

  async function openInSandbox() {
    setCloning(true);
    try {
      const res = await fetch(`${API_BASE}/sandbox/clone`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.sessionToken) localStorage.setItem("ce_session_token", data.sessionToken);
        if (data.organization?.industryId) localStorage.setItem("ce_industry_id", String(data.organization.industryId));
        navigate("/dashboard");
      }
    } finally {
      setCloning(false);
    }
  }

  if (notFound) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-3xl text-center">
        <GraduationCap className="w-12 h-12 mx-auto mb-4 opacity-30" />
        <h1 className="font-serif text-2xl mb-2">Curriculum pack not found</h1>
        <p className="text-muted-foreground mb-6">The pack you requested does not exist.</p>
        <Link href="/curriculum"><Button variant="outline"><ArrowLeft className="w-3.5 h-3.5 mr-1.5" />Back to library</Button></Link>
      </div>
    );
  }

  if (!pack) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl">
      <div className="print:hidden mb-6">
        <Link href="/curriculum">
          <Button variant="ghost" size="sm"><ArrowLeft className="w-3.5 h-3.5 mr-1.5" />All packs</Button>
        </Link>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Academic · Curriculum</p>
        <h1 className="font-serif text-4xl tracking-tight mb-3">{pack.title}</h1>
        <p className="text-lg text-muted-foreground max-w-3xl mb-4 leading-relaxed">{pack.subtitle}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline">{industryLabel(pack.industrySlug)}</Badge>
          <Badge variant="secondary">{LEVEL_LABEL[pack.level]}</Badge>
          <Badge variant="outline">{pack.durationWeeks} {pack.durationWeeks === 1 ? "week" : "weeks"}</Badge>
        </div>
      </motion.div>

      <div className="print:hidden flex flex-wrap items-center gap-2 mb-8">
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="w-3.5 h-3.5 mr-1.5" />Print this pack
        </Button>
        <Button variant="default" size="sm" onClick={openInSandbox} disabled={cloning}>
          {cloning ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5 mr-1.5" />}
          Open in Sandbox
        </Button>
      </div>

      {pack.learningObjectives.length > 0 && (
        <Card className="mb-8">
          <CardContent className="pt-6">
            <h2 className="font-serif text-sm uppercase tracking-widest text-muted-foreground mb-3">Learning objectives</h2>
            <ul className="space-y-2 text-sm leading-relaxed list-disc pl-5">
              {pack.learningObjectives.map((obj, i) => <li key={i}>{obj}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="case" className="w-full">
        <TabsList className="print:hidden">
          <TabsTrigger value="case">Case Study</TabsTrigger>
          <TabsTrigger value="assignment">Assignment</TabsTrigger>
          {pack.rubricMarkdown && <TabsTrigger value="rubric">Rubric</TabsTrigger>}
          <TabsTrigger value="datasets">Datasets</TabsTrigger>
          <TabsTrigger value="citations">Citations</TabsTrigger>
        </TabsList>

        <TabsContent value="case" className="mt-6">
          <Card>
            <CardContent className="pt-6">
              <article className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-serif prose-headings:tracking-tight">
                <ReactMarkdown>{pack.caseStudyMarkdown}</ReactMarkdown>
              </article>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="assignment" className="mt-6 space-y-4">
          {pack.assignmentPrompts.map((a, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <div className="flex items-baseline gap-3 mb-3">
                  <span className="font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="font-serif text-lg">{a.title}</h3>
                </div>
                <p className="text-sm leading-relaxed mb-3">{a.prompt}</p>
                <div className="text-xs text-muted-foreground border-l-2 border-primary/40 pl-3">
                  <span className="uppercase tracking-widest font-semibold">Deliverable</span>
                  <p className="mt-1 leading-relaxed text-foreground/80">{a.deliverable}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {pack.rubricMarkdown && (
          <TabsContent value="rubric" className="mt-6">
            <Card>
              <CardContent className="pt-6">
                <article className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-serif prose-headings:tracking-tight prose-table:text-xs">
                  <ReactMarkdown>{pack.rubricMarkdown}</ReactMarkdown>
                </article>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="datasets" className="mt-6">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-4">
                Each link exports a CSV from the live platform. Students can pull data directly into Excel, R, or Python for the assignment.
              </p>
              <ul className="divide-y">
                {pack.datasetExportUrls.map((d, i) => (
                  <li key={i} className="py-3 flex items-center justify-between gap-4">
                    <span className="text-sm font-medium">{d.label}</span>
                    <a href={d.url} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm">
                        <Download className="w-3.5 h-3.5 mr-1.5" />Download CSV
                      </Button>
                    </a>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="citations" className="mt-6">
          <Card>
            <CardContent className="pt-6">
              <ol className="space-y-3 text-sm">
                {pack.sourceCitations.map((c, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="font-mono text-xs text-muted-foreground tabular-nums w-6 shrink-0">{String(i + 1).padStart(2, "0")}.</span>
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-start gap-1.5">
                      <span>{c.title}</span>
                      <ExternalLink className="w-3 h-3 mt-1 shrink-0" />
                    </a>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
