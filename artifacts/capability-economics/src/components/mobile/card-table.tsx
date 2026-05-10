import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Wraps a table so it scrolls horizontally on small screens instead of
 * blowing out the viewport. For dense tables consider the
 * <ResponsiveCards> companion which renders a card-per-row layout below
 * the `sm` breakpoint.
 */
export function ScrollTable({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("w-full overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0", className)}>
      {children}
    </div>
  );
}

/**
 * Render the same dataset as a real <table> on >=sm screens and as a
 * stacked card list on phones. Pass two render functions; the parent owns
 * the data and column definitions.
 */
export function ResponsiveTable<T>({
  data,
  rowKey,
  table,
  card,
  className,
}: {
  data: T[];
  rowKey: (item: T, index: number) => string;
  table: React.ReactNode;
  card: (item: T, index: number) => React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("w-full", className)}>
      <div className="hidden sm:block overflow-x-auto">{table}</div>
      <div className="sm:hidden flex flex-col gap-2">
        {data.map((item, i) => (
          <div
            key={rowKey(item, i)}
            className="border border-border/40 bg-card p-3 text-sm"
          >
            {card(item, i)}
          </div>
        ))}
      </div>
    </div>
  );
}
