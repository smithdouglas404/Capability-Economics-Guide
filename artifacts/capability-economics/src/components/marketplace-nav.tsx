import { Link, useLocation } from "wouter";
import { FileText, ShoppingCart, Store, Users } from "lucide-react";

const TABS = [
  { href: "/marketplace",              label: "Browse",     Icon: Store,        match: (p: string) => p === "/marketplace" || p.startsWith("/marketplace/listings") },
  { href: "/marketplace/workspace",    label: "Workspace",  Icon: Users,        match: (p: string) => p.startsWith("/marketplace/workspace") },
  { href: "/marketplace/my-purchases", label: "My Library", Icon: ShoppingCart, match: (p: string) => p.startsWith("/marketplace/my-purchases") },
  { href: "/marketplace/sell",         label: "Sell",       Icon: FileText,     match: (p: string) => p.startsWith("/marketplace/sell") },
];

export function MarketplaceNav() {
  const [location] = useLocation();
  return (
    <nav className="border-b mb-6">
      <div className="flex gap-1 -mb-px">
        {TABS.map(({ href, label, Icon, match }) => {
          const active = match(location);
          return (
            <Link
              key={href}
              href={href}
              className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
