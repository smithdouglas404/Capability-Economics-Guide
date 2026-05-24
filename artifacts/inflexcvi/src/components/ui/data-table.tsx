/**
 * <DataTable> — premium table built on TanStack Table.
 *
 * Wraps the typical table operations that every page on the platform
 * re-implements differently: column-click sort (toggleable, multi-column),
 * column visibility toggle, global text filter, pagination, row-click drill.
 *
 * Designed as a drop-in for the static tables on /scorecard, /disruption-
 * index, /alpha, /regulations, /coverage. Stays unstyled-by-default so
 * the page can wrap it in its own Card.
 *
 * Usage:
 *   const columns: ColumnDef<MyRow>[] = [
 *     { accessorKey: "name", header: "Name" },
 *     { accessorKey: "score", header: "Score" },
 *   ];
 *   <DataTable columns={columns} data={rows} onRowClick={...} />
 */
import { useState, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowUp, ArrowDown, ChevronsUpDown, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Initial global filter string. */
  initialSearch?: string;
  /** Show the global text-search input above the table. */
  showSearch?: boolean;
  /** Placeholder for the global search box. */
  searchPlaceholder?: string;
  /** Page size; pass 0 to disable pagination. */
  pageSize?: number;
  /** Row click handler — receives the row's original data. */
  onRowClick?: (row: TData) => void;
  /** Optional empty-state element. */
  emptyState?: ReactNode;
  /** Optional className for the wrapping <table>. */
  tableClassName?: string;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  initialSearch = "",
  showSearch = true,
  searchPlaceholder = "Filter…",
  pageSize = 25,
  onRowClick,
  emptyState,
  tableClassName = "",
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState(initialSearch);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, columnFilters, columnVisibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: pageSize > 0 ? getPaginationRowModel() : undefined,
    initialState: pageSize > 0 ? { pagination: { pageSize } } : undefined,
  });

  const rows = table.getRowModel().rows;

  return (
    <div className="space-y-[var(--token-space-3)]">
      {showSearch && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="relative max-w-md w-full">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder={searchPlaceholder}
              className="rounded-none pl-8 font-mono text-sm"
            />
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {rows.length} of {data.length}
          </div>
        </div>
      )}

      <div className="overflow-x-auto border border-border/60">
        <table className={`w-full text-sm ${tableClassName}`}>
          <thead className="bg-muted/40 border-b border-border/60">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="text-left">
                {hg.headers.map((h) => {
                  const canSort = h.column.getCanSort();
                  const sortDir = h.column.getIsSorted();
                  return (
                    <th
                      key={h.id}
                      className={`px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground ${canSort ? "cursor-pointer hover:text-foreground transition-colors duration-[var(--token-motion-fast)]" : ""}`}
                      onClick={canSort ? h.column.getToggleSortingHandler() : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {canSort && (
                          sortDir === "asc" ? <ArrowUp className="w-3 h-3 opacity-100" />
                          : sortDir === "desc" ? <ArrowDown className="w-3 h-3 opacity-100" />
                          : <ChevronsUpDown className="w-3 h-3 opacity-40" />
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-sm text-muted-foreground">
                {emptyState ?? "No rows match the filter."}
              </td></tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className={`border-t border-border/40 ${onRowClick ? "cursor-pointer hover:bg-muted/30 transition-colors duration-[var(--token-motion-fast)]" : ""}`}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2.5 align-top">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageSize > 0 && table.getPageCount() > 1 && (
        <div className="flex items-center justify-between gap-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="rounded-none h-8 px-2" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <Button variant="outline" size="sm" className="rounded-none h-8 px-2" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
