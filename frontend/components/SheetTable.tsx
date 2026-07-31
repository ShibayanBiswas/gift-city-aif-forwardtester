"use client";

import { DownloadButton } from "@/components/DownloadButton";
import { downloadExcel, type CellValue, type ColumnType } from "@/lib/download";

export function SheetTable({
  title,
  subtitle,
  headers,
  rows,
  filename,
  sheetName,
  minWidth = 960,
  maxHeight = 520,
  onRowClick,
  exportRows,
  columnTypes,
  highlightRows,
}: {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: Array<Array<string | number>>;
  filename: string;
  sheetName?: string;
  minWidth?: number;
  maxHeight?: number;
  onRowClick?: (rowIndex: number) => void;
  /** Typed values for Excel (preferred over display strings). */
  exportRows?: CellValue[][];
  columnTypes?: Array<ColumnType | undefined>;
  /** Row indices to emphasize (e.g. monthly-last expiries in the full calendar). */
  highlightRows?: ReadonlySet<number> | boolean[];
}) {
  const isHighlighted = (i: number) => {
    if (!highlightRows) return false;
    if (Array.isArray(highlightRows)) return Boolean(highlightRows[i]);
    return highlightRows.has(i);
  };
  return (
    <section className="sheet-card overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--ar-border)] bg-gradient-to-r from-[var(--ar-table-head-from)] to-transparent px-5 py-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ar-subtle)] font-ui">Data Table</p>
          <h3 className="font-display text-xl text-[var(--ar-maroon)]">{title}</h3>
          {subtitle ? <p className="mt-1 text-sm text-[var(--ar-muted)] font-ui">{subtitle}</p> : null}
        </div>
        <DownloadButton
          onClick={() =>
            downloadExcel(
              filename,
              headers,
              (exportRows ?? rows).map((r) => r.map((c) => c)),
              {
                sheetName: sheetName ?? title.slice(0, 31),
                title,
                subtitle,
                columnTypes,
              },
            )
          }
        />
      </div>
      <div className="overflow-x-auto">
        <div className="overflow-y-auto" style={{ maxHeight }}>
          <table className="data-table-premium w-full text-left text-sm font-ui" style={{ minWidth }}>
            <thead className="sticky top-0 z-[1] bg-gradient-to-r from-[var(--ar-table-head-from)] to-[var(--ar-table-head-to)] text-xs tracking-wide">
              <tr>
                {headers.map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2.5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={headers.length} className="px-3 py-8 text-center text-[var(--ar-muted)]">
                    No rows for this sheet
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr
                    key={i}
                    className={`odd:bg-[var(--ar-row-alt)] ${
                      isHighlighted(i)
                        ? "bg-[rgba(212,178,76,0.18)] font-semibold ring-1 ring-inset ring-[rgba(212,178,76,0.35)]"
                        : ""
                    } ${onRowClick ? "cursor-pointer hover:bg-[rgba(212,178,76,0.12)]" : ""}`}
                    onClick={onRowClick ? () => onRowClick(i) : undefined}
                  >
                    {r.map((c, j) => (
                      <td key={j} className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
