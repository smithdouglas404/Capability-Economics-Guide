import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { Briefcase, Shield, Users, Network, Building2, Layers, Lightbulb, Activity, ScanSearch, Settings2, Sparkles, Zap, Inbox, CreditCard, DollarSign } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Home", icon: Briefcase },
    { href: "/alpha", label: "CE Alpha", icon: Zap },
    { href: "/cei", label: "CEI Index", icon: Activity },
    { href: "/vce", label: "VCE", icon: Sparkles },
    { href: "/assess", label: "Assess", icon: ScanSearch },
    { href: "/insurance-example", label: "Case Study", icon: Shield },
    { href: "/c-suite", label: "C-Suite", icon: Users },
    { href: "/knowledge-graph", label: "Knowledge Graph", icon: Network },
    { href: "/companies", label: "Companies", icon: Building2 },
    { href: "/projects", label: "Projects", icon: Layers },
    { href: "/insights", label: "Insights", icon: Lightbulb },
    { href: "/organization", label: "My Org", icon: Building2 },
    { href: "/membership", label: "Membership", icon: CreditCard },
    { href: "/review", label: "Review", icon: Inbox },
    { href: "/usage", label: "Usage", icon: DollarSign },
    { href: "/admin", label: "Admin", icon: Settings2 },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/">
            <div className="flex items-center gap-2 cursor-pointer">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-serif font-bold text-lg">
                CE
              </div>
              <span className="font-serif font-semibold text-lg tracking-tight hidden sm:inline">Capability Economics</span>
            </div>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = location === item.href;
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    data-testid={`nav-link-${item.label.replace(/\s+/g, '-').toLowerCase()}`}
                    className={`relative px-3 py-2 rounded-md text-sm font-medium transition-colors hover:text-primary cursor-pointer flex items-center gap-1.5 ${
                      isActive ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                    {isActive && (
                      <motion.div
                        layoutId="nav-indicator"
                        className="absolute inset-0 rounded-md bg-primary/10 -z-10"
                        transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                      />
                    )}
                  </div>
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="flex-1">
        {children}
      </main>
      <footer className="border-t py-12 bg-muted/30">
        <div className="container mx-auto px-4 text-center text-muted-foreground text-sm">
          <p className="font-serif italic mb-2">"Understanding the true value of what your organization can do."</p>
          <p>&copy; {new Date().getFullYear()} Capability Economics Executive Briefing.</p>
        </div>
      </footer>
    </div>
  );
}
