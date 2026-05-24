import { Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PERSONAS, PERSONA_META, usePersona } from "@/lib/persona";

/**
 * Compact persona switcher for the top utility cluster in the global layout
 * header. Replaces the "Reading as X · Switch role" dropdown that used to
 * live inside every PersonaDescription on page bodies — the switcher belongs
 * with the user's other account controls (avatar, credits), not buried under
 * page-specific copy.
 */
export function PersonaTopSwitcher() {
  const { persona, setPersona } = usePersona();
  const label = persona ? PERSONA_META[persona].label : "Set role";
  const emoji = persona ? PERSONA_META[persona].emoji : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="nav-persona-switcher"
          title={persona ? `Reading as ${label} — click to switch` : "Pick a reading lens"}
          className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          {emoji && <span className="text-sm leading-none">{emoji}</span>}
          <span className="leading-none">{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 rounded-none">
        <DropdownMenuLabel className="font-serif text-xs uppercase tracking-widest text-muted-foreground">
          Reading lens
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PERSONAS.map((p) => (
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
              <div className="text-[11px] text-muted-foreground leading-snug">
                {PERSONA_META[p].blurb}
              </div>
            </div>
          </DropdownMenuItem>
        ))}
        {persona && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setPersona(null)}
              className="text-muted-foreground cursor-pointer"
            >
              Clear lens
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
