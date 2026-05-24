/**
 * PageHeader — top-of-page orientation block.
 *
 * Every public-facing page should mount this near the top. The header shows
 * the page title, a section label, and a 1–3 sentence description of what
 * the page is and what the user can do here. The description text adapts to
 * the visitor's chosen persona (PE / VC / F500 / student / professor) — set
 * once on the home page first-visit modal, then re-used everywhere via
 * usePersona() + localStorage.
 *
 * Why: the app has 68 pages and most assume you already know why you're
 * there. PageHeader is the orientation layer — see
 * memory/strategic_ux_overhaul.md problem #1 ("68 pages, no map").
 *
 * Visual style follows the existing companies.tsx / alpha.tsx header
 * pattern: short uppercase tracking-wide section label above a serif h1,
 * with a muted-foreground description paragraph and an optional right-rail
 * for page actions (filters, refresh buttons).
 */
import { Link } from "wouter";
import { Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { PERSONAS, PERSONA_META, usePersona, type Persona } from "@/lib/persona";
import { cn } from "@/lib/utils";

export type PageHeaderDescriptions = {
  /** Fallback description shown when no persona is selected, or when the
   * selected persona doesn't have a custom variant on this page. */
  default: string;
  /** Optional persona-specific copy. Omit any to fall through to default. */
  pe?: string;
  vc?: string;
  f500?: string;
  student?: string;
  professor?: string;
};

export interface PageHeaderProps {
  /** Short label rendered above the title (e.g. "Portfolio", "Index", "Methodology"). */
  eyebrow?: string;
  /** Main page title; rendered in serif. */
  title: string;
  /** Persona-aware description map. Always include `default`. */
  descriptions: PageHeaderDescriptions;
  /** Optional right-rail content (filters, refresh buttons). Page-supplied. */
  actions?: React.ReactNode;
  /** Extra Tailwind classes for the wrapper. */
  className?: string;
}

function descriptionFor(d: PageHeaderDescriptions, persona: Persona | null): string {
  if (!persona) return d.default;
  return d[persona] ?? d.default;
}

export function PageHeader({ eyebrow, title, descriptions, actions, className }: PageHeaderProps) {
  const { persona, setPersona } = usePersona();
  const description = descriptionFor(descriptions, persona);
  const hasPersonaVariant = persona !== null && descriptions[persona] !== undefined;

  return (
    <div className={cn("flex items-end justify-between flex-wrap gap-4", className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="h-px w-5 bg-accent" />
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">{eyebrow}</span>
          </div>
        ) : null}
        <h1 className="font-serif text-4xl tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm mt-2 max-w-3xl leading-relaxed">{description}</p>

        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground/80">
          {persona ? (
            <>
              <span>Reading as</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border/60 bg-muted/30 hover:bg-muted text-foreground font-medium">
                    <span>{PERSONA_META[persona].emoji}</span>
                    <span>{PERSONA_META[persona].label}</span>
                    {hasPersonaVariant ? null : (
                      <span className="ml-1 text-muted-foreground/60">(generic copy)</span>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72">
                  <DropdownMenuLabel>Switch role</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {PERSONAS.map(p => (
                    <DropdownMenuItem
                      key={p}
                      onClick={() => setPersona(p)}
                      className="flex items-start gap-2 cursor-pointer"
                    >
                      <span className="text-base leading-none mt-0.5">{PERSONA_META[p].emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">{PERSONA_META[p].label}</span>
                          {p === persona ? <Check className="w-3 h-3 text-accent" /> : null}
                        </div>
                        <div className="text-[11px] text-muted-foreground leading-snug">{PERSONA_META[p].blurb}</div>
                      </div>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setPersona(null)} className="text-muted-foreground">
                    Clear (generic copy everywhere)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <Link to="/" className="hover:text-foreground underline-offset-2 hover:underline">
              Tell us your role → tailor every page
            </Link>
          )}
        </div>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * PersonaDescription — drop-in addition for pages that already have their
 * own h1 (methodology, alpha, capability-detail, etc.). Renders just the
 * persona-aware description paragraph + the role-switcher chip, no title.
 * One-line addition, no layout disruption.
 *
 * Use this when the page already has good orientation copy of its own
 * but you still want the persona reframing layer.
 */
export function PersonaDescription({ descriptions, className }: { descriptions: PageHeaderDescriptions; className?: string }) {
  const { persona } = usePersona();
  const description = descriptionFor(descriptions, persona);
  // Switcher lives in the global top nav now (<PersonaTopSwitcher>). This
  // component just renders the persona-tailored description.
  return (
    <div className={cn("border-l-2 border-accent/40 pl-3 py-1 my-3 max-w-3xl", className)}>
      <p className="text-sm text-foreground leading-relaxed">{description}</p>
    </div>
  );
}

/**
 * Compact variant — for sub-pages where the full header would be too heavy.
 * Same persona-aware copy, smaller type, no eyebrow.
 */
export function PageHeaderCompact({ title, descriptions, actions }: Omit<PageHeaderProps, "eyebrow" | "className">) {
  const { persona } = usePersona();
  const description = descriptionFor(descriptions, persona);
  return (
    <div className="flex items-start justify-between flex-wrap gap-3 pb-4 border-b border-border/40">
      <div className="min-w-0">
        <h2 className="font-serif text-2xl tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-sm mt-1 max-w-3xl">{description}</p>
      </div>
      {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
    </div>
  );
}

/**
 * First-visit persona-selection modal. Mounts on home.tsx; checks if
 * `ce_persona` is unset, then renders one full-screen card asking the
 * visitor to pick a role. Skip option falls through to `default` copy
 * everywhere.
 */
export function PersonaPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { setPersona } = usePersona();
  if (!open) return null;

  const handlePick = (p: Persona): void => {
    setPersona(p);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
      <div className="bg-background border border-border rounded-lg shadow-2xl max-w-2xl w-full p-8 max-h-[90vh] overflow-y-auto">
        <div className="mb-6">
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="h-px w-5 bg-accent" />
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">§ Welcome</span>
          </div>
          <h2 className="font-serif text-3xl tracking-tight">Who's reading?</h2>
          <p className="text-muted-foreground text-sm mt-2 max-w-xl">
            Pick a role and every page will reframe what it shows for that perspective.
            You can change this any time from the chip below the page title.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PERSONAS.map(p => (
            <button
              key={p}
              onClick={() => handlePick(p)}
              className="text-left p-4 border border-border rounded-lg hover:border-accent hover:bg-muted/30 transition-colors group"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-2xl">{PERSONA_META[p].emoji}</span>
                <span className="font-serif text-lg group-hover:text-accent transition-colors">{PERSONA_META[p].label}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-snug">{PERSONA_META[p].blurb}</p>
            </button>
          ))}
        </div>
        <div className="mt-6 pt-4 border-t border-border/40 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">No role fits? Skip for generic copy.</p>
          <Button variant="ghost" size="sm" onClick={onClose}>Skip</Button>
        </div>
      </div>
    </div>
  );
}
