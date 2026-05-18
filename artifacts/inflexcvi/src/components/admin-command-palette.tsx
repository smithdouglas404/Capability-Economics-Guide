import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  CheckCircle2,
  Users,
  Layers,
  ShieldCheck,
  FileText,
  Sparkles,
  ClipboardList,
  Store,
  Settings,
  CreditCard,
  Award,
  History,
  Bot,
  GanttChart,
  Star,
} from "lucide-react";

/**
 * Global admin command palette — ⌘K / Ctrl+K opens a fuzzy-searchable list
 * of every admin destination. Tabs within `/admin` jump to the section
 * (uses URL hash so the page picks it up on load) and standalone pages
 * navigate by route. Keyboard-first — never need to scroll the sidebar.
 */

interface Destination {
  group: "Dashboard sections" | "Standalone admin pages";
  label: string;
  description?: string;
  shortcut?: string;
  icon: React.ComponentType<{ className?: string }>;
  // Where to send the user: either a route OR a tab name to switch to inside /admin.
  route?: string;
  tab?: string;
}

const DESTINATIONS: Destination[] = [
  // Tabs inside the main /admin dashboard
  { group: "Dashboard sections", label: "Overview",     icon: LayoutDashboard, tab: "overview" },
  { group: "Dashboard sections", label: "Approvals",    icon: CheckCircle2,    tab: "approvals" },
  { group: "Dashboard sections", label: "Members",      icon: Users,           tab: "members" },
  { group: "Dashboard sections", label: "Tiers",        icon: Layers,          tab: "tiers" },
  { group: "Dashboard sections", label: "KYC",          icon: ShieldCheck,     tab: "kyc" },
  { group: "Dashboard sections", label: "Content",      icon: FileText,        tab: "content" },
  { group: "Dashboard sections", label: "Enrichment",   icon: Sparkles,        tab: "enrichment" },
  { group: "Dashboard sections", label: "Assessments",  icon: ClipboardList,   tab: "assessments" },
  { group: "Dashboard sections", label: "Marketplace",  icon: Store,           tab: "marketplace" },
  { group: "Dashboard sections", label: "System",       icon: Settings,        tab: "system" },

  // Standalone admin pages
  { group: "Standalone admin pages", label: "Case studies",       description: "Manage featured + auto-rotation", icon: Star,        route: "/admin/case-studies" },
  { group: "Standalone admin pages", label: "Agent proposals",    description: "HITL approval queue",             icon: Bot,         route: "/admin/agent/proposals" },
  { group: "Standalone admin pages", label: "Economic rules",     description: "CVI / DVX thresholds",            icon: GanttChart,  route: "/admin/economic-rules" },
  { group: "Standalone admin pages", label: "Source quality",     description: "Credibility scoring",             icon: Award,       route: "/admin/source-quality" },
  { group: "Standalone admin pages", label: "Payments",           description: "Approvals + refunds",             icon: CreditCard,  route: "/admin/payments" },
  { group: "Standalone admin pages", label: "Audit chain",        description: "Admin action history",            icon: History,     route: "/admin/audit-chain" },
];

export function AdminCommandPalette() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(d: Destination) {
    setOpen(false);
    if (d.route) {
      navigate(d.route);
    } else if (d.tab) {
      // Tabs live inside /admin; the page reads the URL hash on mount to set the active tab.
      const target = `/admin#${d.tab}`;
      if (window.location.pathname === "/admin") {
        // Already on /admin — update hash + dispatch event for in-page listener.
        window.location.hash = d.tab;
      } else {
        navigate(target);
      }
    }
  }

  const groups = Array.from(new Set(DESTINATIONS.map((d) => d.group)));

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a destination — Overview, Members, Audit chain…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        {groups.map((group, idx) => (
          <div key={group}>
            {idx > 0 && <CommandSeparator />}
            <CommandGroup heading={group}>
              {DESTINATIONS.filter((d) => d.group === group).map((d) => (
                <CommandItem key={d.label} onSelect={() => go(d)} value={`${d.label} ${d.description ?? ""}`}>
                  <d.icon className="w-4 h-4 mr-2 text-muted-foreground" />
                  <div className="flex flex-col">
                    <span>{d.label}</span>
                    {d.description && <span className="text-[10px] text-muted-foreground">{d.description}</span>}
                  </div>
                  {d.shortcut && <CommandShortcut>{d.shortcut}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          </div>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

/**
 * Tiny hint button — renders the "⌘K" keyboard hint inline in headers so
 * users discover the palette exists. Click also opens the palette.
 */
export function AdminCommandHint() {
  return (
    <button
      type="button"
      onClick={() => {
        // Simulate ⌘K via the same key event the palette listens for.
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
      }}
      className="hidden sm:inline-flex items-center gap-1.5 rounded-none border border-border bg-muted/40 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      title="Open admin command palette"
    >
      <kbd className="font-mono">⌘K</kbd>
      <span>Navigate</span>
    </button>
  );
}
