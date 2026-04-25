import { useLocation } from "wouter";
import { Check } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { usePersona } from "@/hooks/use-persona";
import { PERSONA_LIST, PERSONA_META, type PersonaSlug } from "@/lib/persona-nav";

export function PersonaSwitcher() {
  const { activePersonaSlug, setPersona, loading } = usePersona();
  const [, navigate] = useLocation();

  if (loading) return null;

  const current = PERSONA_META[activePersonaSlug];
  const Icon = current.icon;

  const onSwitch = async (slug: PersonaSlug) => {
    if (slug === activePersonaSlug) return;
    await setPersona(slug);
    navigate(PERSONA_META[slug].defaultRoute);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          data-testid="persona-switcher"
          title={`Persona: ${current.label}`}
          className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
        >
          <Icon className="w-3.5 h-3.5" />
          <span className="font-mono uppercase tracking-wider">{current.shortLabel}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 rounded-none">
        <DropdownMenuLabel className="font-serif text-xs uppercase tracking-widest text-muted-foreground">
          Switch persona
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PERSONA_LIST.map((p) => {
          const PIcon = p.icon;
          const active = p.slug === activePersonaSlug;
          return (
            <DropdownMenuItem
              key={p.slug}
              data-testid={`persona-option-${p.slug}`}
              onSelect={(e) => { e.preventDefault(); void onSwitch(p.slug); }}
              className={`cursor-pointer flex items-start gap-3 py-2.5 ${active ? "bg-primary/10" : ""}`}
            >
              <PIcon className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
              <div className="flex flex-col flex-1">
                <span className="text-sm font-medium leading-tight flex items-center gap-2">
                  {p.label}
                  {active && <Check className="w-3.5 h-3.5 text-primary" />}
                </span>
                <span className="text-xs text-muted-foreground leading-tight mt-0.5">{p.description}</span>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
