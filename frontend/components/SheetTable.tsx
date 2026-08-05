"use client";

import { DownloadButton } from "@/components/DownloadButton";
import { withHorizontalMinus } from "@/lib/api";
import { downloadExcel, type CellValue, type ColumnType } from "@/lib/download";

const DEFAULT_STICKY_WIDTHS = [72, 118, 118];

/** Keep numeric minus signs as a pure horizontal stroke in desk tables. */
function displayCell(c: string | number): string {
  if (typeof c === "number") {
    if (!Number.isFinite(c)) return "—";
    return withHorizontalMinus(String(c));
  }
  return c.replace(/^-/, "\u2212");
}

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
  stickyLeftCols = 0,
  stickyColWidths,
  hideDownload = false,
}: {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: Array<Array<string | number>>;
  filename: string;
  sheetName?: string;
  minWidth?: number;
  maxHeight?: number | string;
  onRowClick?: (rowIndex: number) => void;
  /** Typed values for Excel (preferred over display strings). */
  exportRows?: CellValue[][];
  columnTypes?: Array<ColumnType | undefined>;
  /** Row indices to emphasize (e.g. monthly-last expiries in the full calendar). */
  highlightRows?: ReadonlySet<number> | boolean[];
  /** Freeze the first N columns while scrolling horizontally (wide matrices only). */
  stickyLeftCols?: number;
  stickyColWidths?: number[];
  /** Hide the sheet-local download when the page already has a full export. */
  hideDownload?: boolean;
}) {
  const isHighlighted = (i: number) => {
    if (!highlightRows) return false;
    if (Array.isArray(highlightRows)) return Boolean(highlightRows[i]);
    return highlightRows.has(i);
  };

  const useSticky = stickyLeftCols > 0;
  const widths = stickyColWidths?.length ? stickyColWidths : DEFAULT_STICKY_WIDTHS;

  const stickyLeft = (colIndex: number) => {
    if (!useSticky || colIndex >= stickyLeftCols) return undefined;
    let left = 0;
    for (let i = 0; i < colIndex; i += 1) {
      left += widths[i] ?? 96;
    }
    return left;
  };

  // Default sheets stretch full card width (w-full + minWidth). Sticky matrices grow with columns.
  const tableMinWidth = useSticky
    ? Math.max(
        minWidth,
        widths.slice(0, stickyLeftCols).reduce((a, b) => a + b, 0) +
          Math.max(0, headers.length - stickyLeftCols) * 96,
      )
    : minWidth;

  return (
    <section className="sheet-card">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--ar-border)] bg-gradient-to-r from-[var(--ar-table-head-from)] to-transparent px-5 py-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ar-subtle)] font-ui">Data Table</p>
          <h3 className="font-display text-xl text-[var(--ar-maroon)]">{title}</h3>
          {subtitle ? <p className="mt-1 text-sm text-[var(--ar-muted)] font-ui">{subtitle}</p> : null}
        </div>
        {!hideDownload ? (
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
        ) : null}
      </div>
      {/*
        Use sheet-table-scroll (overflow: auto on both axes) — never desk-rail-scroll,
        which forces overflow-y: hidden and killed vertical scroll on sticky matrices.
      */}
      <div
        className="sheet-table-scroll border-t border-[var(--ar-border)]"
        style={{ maxHeight }}
      >
        <table
          className={
            useSticky
              ? "data-table-premium w-max max-w-none text-left text-sm font-ui"
              : "data-table-premium sheet-table-fill w-full text-left text-sm font-ui"
          }
          style={
            useSticky
              ? { minWidth: tableMinWidth }
              : { minWidth: tableMinWidth, width: "100%" }
          }
        >
          <thead className="sticky top-0 z-[3] bg-gradient-to-r from-[var(--ar-table-head-from)] to-[var(--ar-table-head-to)] text-xs tracking-wide shadow-[0_1px_0_var(--ar-border)]">
            <tr>
              {headers.map((h, j) => {
                const left = stickyLeft(j);
                const isSticky = left != null;
                return (
                  <th
                    key={`${h}-${j}`}
                    className={`whitespace-nowrap px-3 py-2.5 ${
                      isSticky
                        ? "sticky z-[4] bg-[var(--ar-table-head-from)] shadow-[1px_0_0_var(--ar-border)]"
                        : ""
                    }`}
                    style={
                      isSticky
                        ? {
                            left,
                            minWidth: widths[j] ?? 96,
                            width: widths[j] ?? 96,
                          }
                        : useSticky
                          ? { minWidth: 96 }
                          : undefined
                    }
                  >
                    {h}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={Math.max(headers.length, 1)}
                  className="px-3 py-8 text-center text-[var(--ar-muted)]"
                >
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
                  {r.map((c, j) => {
                    const left = stickyLeft(j);
                    const isSticky = left != null;
                    const odd = i % 2 === 1;
                    return (
                      <td
                        key={j}
                        className={`whitespace-nowrap px-3 py-1.5 tabular-nums ${
                          isSticky
                            ? `sticky z-[2] shadow-[1px_0_0_var(--ar-border)] ${
                                odd ? "bg-[var(--ar-panel)]" : "bg-[var(--ar-surface)]"
                              }`
                            : ""
                        }`}
                        style={
                          isSticky
                            ? {
                                left,
                                minWidth: widths[j] ?? 96,
                                width: widths[j] ?? 96,
                              }
                            : undefined
                        }
                      >
                        {displayCell(c)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
