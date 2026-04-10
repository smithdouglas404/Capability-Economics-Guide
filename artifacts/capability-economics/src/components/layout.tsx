import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { Briefcase, Shield, Users } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Executive Summary", icon: Briefcase },
    { href: "/insurance-example", label: "Industry Case: Insurance", icon: Shield },
    { href: "/c-suite", label: "C-Suite Perspectives", icon: Users },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-serif font-bold text-lg">
              CE
            </div>
            <span className="font-serif font-semibold text-lg tracking-tight">Capability Economics</span>
          </div>
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = location === item.href;
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    data-testid={`nav-link-${item.label.replace(/\s+/g, '-').toLowerCase()}`}
                    className={`relative px-4 py-2 rounded-md text-sm font-medium transition-colors hover:text-primary cursor-pointer flex items-center gap-2 ${
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
