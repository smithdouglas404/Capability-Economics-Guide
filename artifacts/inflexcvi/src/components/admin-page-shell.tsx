import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { AdminCommandPalette, AdminCommandHint } from "@/components/admin-command-palette";

interface AdminPageShellProps {
  title: string;
  description?: string;
  /** Optional right-aligned slot for action buttons (Refresh, Save, etc.) */
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Consistent shell for standalone admin pages (case-studies, agent-proposals,
 * audit-chain, economic-rules, source-quality, payments). Provides a
 * back-to-dashboard breadcrumb, the global ⌘K hint, and matches the visual
 * language of the main /admin sidebar layout.
 */
export function AdminPageShell({ title, description, actions, children }: AdminPageShellProps) {
  return (
    <div className="min-h-screen bg-background">
      <AdminCommandPalette />
      <div className="max-w-screen-2xl mx-auto p-4 sm:p-6 lg:p-8">
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="min-w-0">
            <Link href="/admin" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2 font-mono uppercase tracking-wider">
              <ArrowLeft className="w-3 h-3" /> Admin
            </Link>
            <h1 className="text-2xl font-serif tracking-tight text-foreground truncate">{title}</h1>
            {description && <p className="text-muted-foreground text-xs mt-1">{description}</p>}
          </div>
          <div className="flex items-center gap-2">
            <AdminCommandHint />
            {actions}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
