import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Wraps charts (Recharts ResponsiveContainer, custom SVG, etc.) and gives
 * them a smaller, mobile-friendly height below the `sm` breakpoint while
 * preserving the desktop layout. Apply as a sibling wrapper around the
 * chart container.
 */
export function ResponsiveChart({
  children,
  className,
  mobileHeight = 220,
  desktopHeight = 360,
}: {
  children: React.ReactNode;
  className?: string;
  mobileHeight?: number;
  desktopHeight?: number;
}) {
  return (
    <div
      className={cn("w-full", className)}
      style={
        {
          // Tailwind v4 inline arbitrary values would need plugin; use CSS var.
          "--mobile-h": `${mobileHeight}px`,
          "--desktop-h": `${desktopHeight}px`,
          height: "var(--mobile-h)",
        } as React.CSSProperties
      }
    >
      <style>{`
        @media (min-width: 640px) {
          [data-responsive-chart="true"] { height: var(--desktop-h) !important; }
        }
      `}</style>
      <div data-responsive-chart="true" className="w-full h-full">
        {children}
      </div>
    </div>
  );
}
