/**
 * Marketplace reviews UI — summary card (avg + histogram), per-review
 * list, and an inline review form when the user has a paid purchase.
 *
 * Hits /api/marketplace/listings/:id/reviews. POST is gated server-side
 * by the buyer-has-paid-purchase check, so we can show the form
 * unconditionally for signed-in users and surface the 403 if it returns.
 *
 * Move 4 / strategic UX overhaul — the primitive that turns the catalog
 * into a marketplace (buyer voice, social proof, accountability).
 */
import { useEffect, useState, useCallback } from "react";
import { useUser } from "@clerk/react";
import { Star, MessageSquare, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface ReviewRow {
  id: number;
  buyerDisplayName: string | null;
  rating: number;
  body: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ReviewSummary {
  count: number;
  avgRating: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
}

export function MarketplaceReviews({ listingId }: { listingId: number }) {
  const { isSignedIn } = useUser();
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/marketplace/listings/${listingId}/reviews`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as { reviews: ReviewRow[]; summary: ReviewSummary };
      setReviews(data.reviews);
      setSummary(data.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [listingId]);

  useEffect(() => { void load(); }, [load]);

  const submit = async (): Promise<void> => {
    if (!isSignedIn) {
      setError("Sign in to leave a review.");
      return;
    }
    if (!rating) {
      setError("Pick a rating (1-5 stars).");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const resp = await fetch(`/api/marketplace/listings/${listingId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, body: body.trim() || undefined }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${resp.status}`);
      }
      setRating(0);
      setBody("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading reviews…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            Buyer reviews
            {summary && summary.count > 0 && (
              <span className="text-sm text-muted-foreground font-normal ml-1">· {summary.count}</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {summary && summary.count > 0 ? (
            <div className="grid grid-cols-[auto_1fr] gap-6 items-center">
              <div className="text-center">
                <div className="font-serif text-4xl tabular-nums">{summary.avgRating.toFixed(1)}</div>
                <Stars value={summary.avgRating} size="sm" />
                <div className="text-xs text-muted-foreground mt-1">{summary.count} buyer{summary.count === 1 ? "" : "s"}</div>
              </div>
              <div className="space-y-1">
                {([5, 4, 3, 2, 1] as const).map(s => {
                  const n = summary.distribution[String(s) as "1" | "2" | "3" | "4" | "5"];
                  const pct = summary.count > 0 ? Math.round((n / summary.count) * 100) : 0;
                  return (
                    <div key={s} className="flex items-center gap-2 text-xs">
                      <span className="w-4 text-right tabular-nums text-muted-foreground">{s}</span>
                      <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                      <div className="flex-1 h-1.5 bg-muted rounded overflow-hidden">
                        <div className="h-full bg-amber-500" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-8 text-right tabular-nums text-muted-foreground">{n}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-2">No reviews yet — be the first.</p>
          )}
        </CardContent>
      </Card>

      {/* Inline review form (server enforces purchase requirement) */}
      {isSignedIn && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Leave a review</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Only available if you've completed a paid purchase of this listing. We'll show your name + rating; body is optional.
            </p>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  className="p-1 hover:scale-110 transition-transform"
                  aria-label={`Rate ${n} stars`}
                >
                  <Star
                    className={cn(
                      "w-6 h-6",
                      n <= rating ? "text-amber-500 fill-amber-500" : "text-muted-foreground/40",
                    )}
                  />
                </button>
              ))}
              <span className="text-sm text-muted-foreground ml-2">{rating ? `${rating} / 5` : "Pick a rating"}</span>
            </div>
            <Textarea
              placeholder="Optional: what was useful about this report / dataset / template?"
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={3}
              maxLength={4000}
              className="resize-none"
            />
            {error && <div className="text-xs text-rose-500 bg-rose-500/10 border border-rose-500/30 px-3 py-2 rounded">{error}</div>}
            <Button onClick={submit} disabled={submitting || !rating} size="sm">
              {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Submit review
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Review list */}
      {reviews.length > 0 && (
        <Card>
          <CardContent className="divide-y divide-border/40">
            {reviews.map(r => (
              <div key={r.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex items-center gap-2 mb-1">
                  <Stars value={r.rating} size="sm" />
                  <span className="text-sm font-medium">{r.buyerDisplayName ?? "Anonymous"}</span>
                  <span className="text-[11px] text-muted-foreground ml-auto">
                    {new Date(r.createdAt).toISOString().slice(0, 10)}
                  </span>
                </div>
                {r.body && <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{r.body}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stars({ value, size = "md" }: { value: number; size?: "sm" | "md" }) {
  const px = size === "sm" ? 3.5 : 5;
  return (
    <div className="inline-flex items-center gap-0.5" aria-label={`${value.toFixed(1)} of 5`}>
      {[1, 2, 3, 4, 5].map(n => (
        <Star
          key={n}
          className={cn(
            n <= Math.round(value) ? "text-amber-500 fill-amber-500" : "text-muted-foreground/30",
          )}
          style={{ width: `${px * 4}px`, height: `${px * 4}px` }}
        />
      ))}
    </div>
  );
}
