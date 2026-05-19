/**
 * StreamingBrief — reusable "generate a fresh AI brief and render it as
 * it streams in" panel. Used on /insights and /capability/:id (Move 10b
 * of the strategic UX overhaul).
 *
 * Wraps @ai-sdk/react useCompletion. Caller provides the endpoint + the
 * request body. The component handles:
 *   - the trigger button
 *   - streaming progress (blinking cursor while in-flight)
 *   - persona-aware framing (pulls ce_persona from lib/persona)
 *   - error surface
 *   - markdown rendering via ReactMarkdown + remark-gfm
 *   - download-as-markdown button once stream completes
 *   - visible "Streaming · Vercel AI SDK" badge so the SDK presence is felt
 */
import { useState } from "react";
import { useCompletion } from "@ai-sdk/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Sparkles, Loader2, Zap, Download, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { usePersona } from "@/lib/persona";
import { downloadFile } from "@/lib/exports";

export interface StreamingBriefProps {
  /** API endpoint that streams text via the AI SDK text protocol. */
  api: string;
  /** Static fields merged into every request body (e.g. {industryId: 1}). */
  body?: Record<string, unknown>;
  /** Title shown on the card. */
  title: string;
  /** Filename stem used for the download button. */
  downloadFilename: string;
  /** Optional CTA label on the trigger button. */
  triggerLabel?: string;
  /** Show the "additional context" textarea inside the card. */
  showContextField?: boolean;
}

export function StreamingBrief({
  api,
  body = {},
  title,
  downloadFilename,
  triggerLabel = "Generate fresh brief",
  showContextField = false,
}: StreamingBriefProps) {
  const { persona } = usePersona();
  const [context, setContext] = useState("");

  const {
    completion,
    complete,
    isLoading,
    error,
  } = useCompletion({
    api,
    streamProtocol: "text",
  });

  const handleGenerate = (): void => {
    void complete(context, { body: { ...body, persona } });
  };

  const handleDownload = (): void => {
    if (!completion) return;
    const today = new Date().toISOString().slice(0, 10);
    downloadFile(`${downloadFilename}-${today}.md`, completion, "text/markdown;charset=utf-8");
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isLoading ? <Loader2 className="w-4 h-4 text-accent animate-spin" /> : <Sparkles className="w-4 h-4 text-accent" />}
          <CardTitle className="text-base">{title}</CardTitle>
          {completion && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
              <Zap className="w-2.5 h-2.5 mr-0.5" /> Streaming · Vercel AI SDK
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {completion && !isLoading && (
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="w-4 h-4 mr-1" /> Download
            </Button>
          )}
          <Button size="sm" onClick={handleGenerate} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
            {triggerLabel}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {showContextField && !isLoading && (
          <Textarea
            placeholder="Optional: add context to focus the brief (e.g. 'we just acquired Acme', 'focused on EMEA')."
            value={context}
            onChange={e => setContext(e.target.value)}
            rows={2}
            maxLength={1000}
            className="resize-none text-sm"
          />
        )}
        {error && (
          <div className="border border-rose-500/40 bg-rose-500/10 text-rose-500 px-3 py-2 rounded text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error.message}</span>
          </div>
        )}
        {completion ? (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{completion}</ReactMarkdown>
            {isLoading && (
              <span className="inline-block w-2 h-4 bg-accent animate-pulse ml-1" aria-hidden />
            )}
          </div>
        ) : (
          !isLoading && (
            <p className="text-sm text-muted-foreground">
              Click <span className="font-medium text-foreground">{triggerLabel}</span> to stream a fresh, persona-aware brief built from live data.
              {persona ? null : <> Pick a role on the home page first for tailored framing.</>}
            </p>
          )
        )}
      </CardContent>
    </Card>
  );
}
