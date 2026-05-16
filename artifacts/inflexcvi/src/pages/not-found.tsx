import { Link } from "wouter";
import { ArrowRight } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-[80vh] flex items-center justify-center px-6">
      <div className="max-w-md w-full">
        <div className="inline-flex items-center gap-2 mb-8">
          <span className="h-px w-5 bg-accent" />
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">404 — Not Found</span>
        </div>
        <h1 className="font-serif text-6xl lg:text-7xl leading-[0.95] tracking-tight mb-6">
          Page not<br /><em className="not-italic italic text-foreground/60">found.</em>
        </h1>
        <p className="font-serif italic text-lg text-foreground/60 leading-relaxed mb-10">
          This page doesn't exist or has been moved.
        </p>
        <Link
          href="/"
          className="inline-flex h-11 items-center px-7 font-mono text-[11px] uppercase tracking-[0.18em] bg-foreground text-background hover:bg-foreground/90 transition-colors gap-2 group"
        >
          Return home
          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>
    </div>
  );
}
