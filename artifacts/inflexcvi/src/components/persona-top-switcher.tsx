import { Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PERSONAS, PERSONA_META, usePersona } from "@/lib/persona";

/**
 * Reading-lens (persona) selector for the /account/profile page.
 *
 * Renders a Card matching the rest of the profile editor's section style.
 * Each persona is a radio-like row with emoji + label + blurb. Clicking
 * a row applies the persona globally; clicking the active row again clears.
 *
 * Replaces the inline "Reading as X · Switch role" dropdown that used to
 * live in PersonaDescription — the lens is a profile-level preference, not
 * a page-level affordance.
 */
export function PersonaTopSwitcher() {
  const { persona, setPersona } = usePersona();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Reading lens</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground leading-relaxed mb-3">
          Pages tailor copy, framing, and highlighted metrics to the lens you pick.
          You can change this any time.
        </p>
        <div className="space-y-1.5">
          {PERSONAS.map((p) => {
            const active = p === persona;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPersona(active ? null : p)}
                data-testid={`persona-option-${p}`}
                className={`w-full text-left flex items-start gap-3 p-3 border transition-colors ${
                  active
                    ? "border-accent bg-accent/5"
                    : "border-border hover:border-accent/40 hover:bg-muted/30"
                }`}
              >
                <span className="text-xl leading-none mt-0.5">{PERSONA_META[p].emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm">{PERSONA_META[p].label}</span>
                    {active && <Check className="w-3.5 h-3.5 text-accent" />}
                  </div>
                  <div className="text-xs text-muted-foreground leading-snug mt-0.5">
                    {PERSONA_META[p].blurb}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {persona && (
          <p className="text-[11px] text-muted-foreground mt-2">
            Click the active option above to clear and revert to generic copy.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
