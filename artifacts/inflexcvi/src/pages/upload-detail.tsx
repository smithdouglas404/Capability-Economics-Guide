/**
 * /upload/:id — detail view for a past upload analysis. Renders the stored
 * markdown report + the structured analysis blob, with a re-download CTA
 * and a "back to upload" link.
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { useUser, SignInButton } from "@clerk/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Download, FileText, Loader2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { downloadFile } from "@/lib/exports";

interface UploadAnalysis {
  id: number;
  userId: string;
  filename: string;
  fileType: string | null;
  status: string;
  report: string | null;
  errorMessage: string | null;
  createdAt: string;
  analysis?: {
    claims?: Array<{ text: string; confidence?: number }>;
    matched?: Array<{ capabilityName: string; industryName?: string | null; consensusScore?: number | null; dvxScore?: number | null }>;
    strongest?: Array<{ name: string; reason: string }>;
    vulnerable?: Array<{ name: string; reason: string }>;
    missing?: Array<{ name: string; reason: string }>;
    investorQuestions?: string[];
  } | null;
}

export default function UploadDetail() {
  const params = useParams() as { id?: string };
  const id = Number(params.id);
  const { isSignedIn } = useUser();
  const [data, setData] = useState<UploadAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn || !Number.isFinite(id) || id <= 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`/api/upload-analysis/${id}`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error ?? `Request failed (${r.status})`);
        }
        return r.json();
      })
      .then((d: UploadAnalysis) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load analysis"))
      .finally(() => setLoading(false));
  }, [id, isSignedIn]);

  if (!isSignedIn) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-3xl">
        <Card className="rounded-none border-border/60">
          <CardContent className="p-8 text-center space-y-4">
            <h1 className="font-serif text-2xl">Sign in to view this analysis</h1>
            <p className="text-muted-foreground text-sm">Past upload analyses are scoped to your account.</p>
            <SignInButton mode="modal">
              <Button>Sign in</Button>
            </SignInButton>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-4xl">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading analysis…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-3xl">
        <Card className="rounded-none border-destructive/30 bg-destructive/[0.04]">
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-destructive" />
              <h1 className="font-serif text-lg">Couldn't load analysis</h1>
            </div>
            <p className="text-sm text-muted-foreground">{error ?? "Not found. It may have been removed or belongs to another account."}</p>
            <Link href="/upload">
              <Button variant="outline" size="sm" className="rounded-none">
                <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Back to upload
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const onDownload = () => {
    if (!data.report) return;
    const safeBase = data.filename.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() || "analysis";
    downloadFile(`${safeBase}-ce-analysis.md`, data.report, "text/markdown");
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link href="/upload">
          <Button variant="ghost" size="sm" className="rounded-none -ml-2">
            <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Back to upload
          </Button>
        </Link>
        {data.report && (
          <Button onClick={onDownload} variant="outline" size="sm" className="rounded-none">
            <Download className="w-3.5 h-3.5 mr-1.5" /> Re-download .md
          </Button>
        )}
      </div>

      <PageHeader
        eyebrow="Capability Value Assessment"
        title={data.filename}
        descriptions={{ default: `Run on ${new Date(data.createdAt).toLocaleString()}` }}
      />

      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="rounded-none uppercase tracking-wider text-[10px]">
          {data.status}
        </Badge>
        {data.fileType && (
          <Badge variant="outline" className="rounded-none uppercase tracking-wider text-[10px]">
            <FileText className="w-3 h-3 mr-1" /> {data.fileType}
          </Badge>
        )}
        {data.analysis?.matched && (
          <Badge variant="outline" className="rounded-none uppercase tracking-wider text-[10px]">
            {data.analysis.matched.length} capabilities matched
          </Badge>
        )}
      </div>

      {data.status === "failed" && (
        <Card className="rounded-none border-destructive/30 bg-destructive/[0.04]">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className="w-4 h-4 text-destructive" />
              <h2 className="font-serif text-base">Analysis failed</h2>
            </div>
            <p className="text-sm text-muted-foreground">{data.errorMessage ?? "An unknown error occurred during analysis. Try re-running on /upload."}</p>
          </CardContent>
        </Card>
      )}

      {data.report && (
        <Card className="rounded-none border-border/60">
          <CardHeader>
            <CardTitle className="font-serif text-lg">Analysis</CardTitle>
          </CardHeader>
          <CardContent className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.report}</ReactMarkdown>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
