/** Branded Anand Rathi Wealth .xlsx downloads (logo + typed cells + desk styling). */

import ExcelJS from "exceljs";
import { formatDeskDate, isPlausibleTradingDate } from "@/lib/api";

export type CellValue = string | number | boolean | Date | null | undefined;

/** Explicit Excel cell semantics — preferred over formatted display strings. */
export type ColumnType =
  | "text"
  | "number"
  | "integer"
  | "year"
  | "percent"
  | "pct_points"
  | "date"
  | "currency";

export type ExcelSheetSpec = {
  name: string;
  title: string;
  subtitle?: string;
  headers: string[];
  rows: CellValue[][];
  /** Parallel to headers; inferred from header text when omitted. */
  columnTypes?: Array<ColumnType | undefined>;
};

const BRAND = {
  maroon: "FF7A1E2C",
  gold: "FFD4B24C",
  goldDark: "FFB8860B",
  altRow: "FFFAF6F0",
  muted: "FF6B5E55",
  ink: "FF1F1612",
  white: "FFFFFFFF",
  softGold: "FFFFF8EC",
  bannerEdge: "FFE8D9C0",
  borderStrong: "FF7A1E2C",
  grid: "FFCDBBA8",
  neg: "FF9B1C2C",
  footerBg: "FFF7F1E8",
} as const;

type BorderEdge = { style: "thin" | "medium" | "double"; color: { argb: string } };

const GOLD_BORDER: BorderEdge = { style: "thin", color: { argb: BRAND.gold } };
const MEDIUM_MAROON: BorderEdge = { style: "medium", color: { argb: BRAND.borderStrong } };
const GRID_BORDER: BorderEdge = { style: "thin", color: { argb: BRAND.grid } };
const DOUBLE_MAROON: BorderEdge = { style: "double", color: { argb: BRAND.borderStrong } };

function fullBorder(
  top: BorderEdge = GRID_BORDER,
  right: BorderEdge = GRID_BORDER,
  bottom: BorderEdge = GRID_BORDER,
  left: BorderEdge = GRID_BORDER,
) {
  return { top, right, bottom, left };
}

const LOGO_PATH = "/brand/arwl-logo.png";
let logoBytes: Uint8Array | null = null;

async function loadLogoBytes(): Promise<Uint8Array> {
  if (logoBytes) return logoBytes;
  const res = await fetch(LOGO_PATH);
  if (!res.ok) throw new Error("Could not load company logo for Excel export");
  logoBytes = new Uint8Array(await res.arrayBuffer());
  return logoBytes;
}

function ensureXlsxName(filename: string): string {
  const base = filename.replace(/\.csv$/i, "").replace(/\.xlsx$/i, "");
  return `${base}.xlsx`;
}

function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/*/?:[\]]/g, " ").trim().slice(0, 31);
  return cleaned || "Sheet";
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = ensureXlsxName(filename);
  a.click();
  URL.revokeObjectURL(url);
}

function inferColumnType(header: string): ColumnType {
  const h = header.toLowerCase().trim();

  // Spot / Nifty levels before any "expiry" date heuristic (e.g. "Nifty Level On Expiry").
  // Exclude return-rate headers ("Absolute Nifty Return") — those are fractions.
  if (/\bnifty\b/.test(h) && !/\bdate\b/.test(h) && !/\breturn\b/.test(h)) {
    return "number";
  }

  // Real calendar fields only — never "Nifty On Expiry", "Start Year", "… From Start".
  if (
    /(^|\s)(trading\s+)?date$/.test(h) ||
    /\b(start date|end date)\b/.test(h) ||
    h === "expiry" ||
    h === "expiry date" ||
    h === "observation expiry" ||
    h.endsWith(" expiry date") ||
    (/\bexpiry\b/.test(h) && !/\blevel\b/.test(h) && !/\bcost\b/.test(h) && !/\bnifty\b/.test(h))
  ) {
    return "date";
  }

  // Strike as % of spot is stored as points (137 = 137%), not a 0–1 ratio.
  if (
    /\bstrike(\s+as)?(\s+percent|\s+pct|\s+%)\b/.test(h) ||
    h === "strike percent" ||
    h === "strike %" ||
    h.includes("strike as percent of spot")
  ) {
    return "pct_points";
  }

  // Fraction rates (0.066 = 6.6%) — must beat trailing-"%" → pct_points.
  if (
    /\b(forward|discount|volatility|vol near|vol far|return level)\b/.test(h) ||
    (/\brate\b/.test(h) && !/\bhit rate\b/.test(h) && !/\bpoints\b/.test(h))
  ) {
    return "percent";
  }
  if (/\b(irr|hit rate|share above)\b/.test(h) && !/\bcrore/.test(h) && !/%\s*$/.test(h)) {
    return "percent";
  }

  // Trailing % with pre-scaled desk points (e.g. "Mean IRR %", "Share Above 100 Crores %").
  if (/%\s*$/.test(h) || h.endsWith(" %") || /\bpct\b|\bpoints\b/.test(h)) {
    return "pct_points";
  }

  // Calendar years must never use thousand separators (2,001 → 2001).
  if (/\b(start\s+)?year\b/.test(h) || h === "year") {
    return "year";
  }

  // Counts / ids only — never raw option quantity (−91.5) or calendar-day offsets.
  if (
    /\b(path(\s+number)?|#|count|month offset|trading days|number of paths|observation number)\b/.test(
      h,
    )
  ) {
    return "integer";
  }

  if (/\b(crore|in crores)\b/.test(h) && !/\b(rate|irr|share|hit)\b/.test(h)) {
    return "currency";
  }

  if (
    /\b(crore|terminal|total|spot|strike|nav|delta|cost|fee|mtm|g-sec|cash|principal|investment|brokerage|gst|quantity|qty|days)\b/.test(
      h,
    )
  ) {
    return "number";
  }
  return "text";
}

function isDeskDateLabel(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  return /^\d{1,2}-[A-Za-z]{3}-\d{4}$/.test(raw.trim());
}

function coerceCell(
  raw: CellValue,
  type: ColumnType,
): { value: ExcelJS.CellValue; numFmt?: string } {
  if (raw == null || raw === "") return { value: "" };

  if (type === "date") {
    // Write as text (DD-MMM-YYYY), never Excel Date serials — avoids 30-Dec-99
    // junk rows when a blank/zero cell is formatted as a date.
    if (isDeskDateLabel(raw)) return { value: String(raw).trim() };
    if (!isPlausibleTradingDate(raw)) return { value: "" };
    return { value: formatDeskDate(raw) };
  }

  if (type === "pct_points") {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      // Already percent points (137 or 0.005499). Keep enough decimals for fee rates.
      const numFmt = Math.abs(raw) > 0 && Math.abs(raw) < 0.01 ? '0.000000"%"' : '0.000"%"';
      return { value: raw, numFmt };
    }
    if (typeof raw === "string") {
      const cleaned = raw.replace(/,/g, "").replace(/%/g, "").trim();
      const n = Number(cleaned);
      if (Number.isFinite(n) && cleaned !== "") {
        const numFmt = Math.abs(n) > 0 && Math.abs(n) < 0.01 ? '0.000000"%"' : '0.000"%"';
        return { value: n, numFmt };
      }
    }
    return { value: String(raw) };
  }

  if (type === "percent") {
    // Values are 0–1 fractions (IRR, vol, forward). Do not auto-scale by magnitude —
    // that wrongly turns a 200% Nifty return (2.0) into 2%.
    if (typeof raw === "number" && Number.isFinite(raw)) {
      const numFmt = Math.abs(raw) > 0 && Math.abs(raw) < 0.001 ? "0.000000%" : "0.00%";
      return { value: raw, numFmt };
    }
    if (typeof raw === "string") {
      const cleaned = raw.replace(/,/g, "").replace(/%/g, "").trim();
      const n = Number(cleaned);
      if (Number.isFinite(n)) {
        // Strings with an explicit % sign, or large bare numbers, are percent points.
        const ratio = /%/.test(String(raw)) || Math.abs(n) > 1.5 ? n / 100 : n;
        const numFmt = Math.abs(ratio) > 0 && Math.abs(ratio) < 0.001 ? "0.000000%" : "0.00%";
        return { value: ratio, numFmt };
      }
    }
    return { value: String(raw) };
  }

  if (type === "year") {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return { value: Math.trunc(raw), numFmt: "0" };
    }
    if (typeof raw === "string") {
      const cleaned = raw.replace(/,/g, "").trim();
      const n = Number(cleaned);
      if (Number.isFinite(n) && cleaned !== "") {
        return { value: Math.trunc(n), numFmt: "0" };
      }
    }
    return { value: String(raw) };
  }

  if (type === "integer" || type === "number" || type === "currency") {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return {
        value: raw,
        numFmt:
          type === "integer"
            ? "#,##0"
            : type === "currency"
              ? '#,##0.000" Cr"'
              : "#,##0.000",
      };
    }
    if (typeof raw === "string") {
      const cleaned = raw.replace(/,/g, "").replace(/%/g, "").trim();
      const n = Number(cleaned);
      if (Number.isFinite(n) && cleaned !== "") {
        return {
          value: n,
          numFmt:
            type === "integer"
              ? "#,##0"
              : type === "currency"
                ? '#,##0.000" Cr"'
                : "#,##0.000",
        };
      }
    }
    return { value: String(raw) };
  }

  if (typeof raw === "number" && Number.isFinite(raw)) return { value: raw };
  if (typeof raw === "boolean") return { value: raw };
  return { value: String(raw) };
}

function resolveTypes(spec: ExcelSheetSpec): ColumnType[] {
  if (spec.columnTypes && spec.columnTypes.length !== spec.headers.length) {
    throw new Error(
      `Excel sheet "${spec.name}": columnTypes length ${spec.columnTypes.length} ≠ headers ${spec.headers.length}`,
    );
  }
  return spec.headers.map((h, i) => spec.columnTypes?.[i] ?? inferColumnType(h));
}

function writeSheet(
  workbook: ExcelJS.Workbook,
  imageId: number,
  spec: ExcelSheetSpec,
  metaLine?: string,
) {
  const colCount = Math.max(spec.headers.length, 4);
  const types = resolveTypes(spec);
  const dataCols = Math.max(spec.headers.length, 1);
  for (let r = 0; r < spec.rows.length; r += 1) {
    if (spec.rows[r].length !== spec.headers.length) {
      throw new Error(
        `Excel sheet "${spec.name}" row ${r + 1}: ${spec.rows[r].length} cells ≠ ${spec.headers.length} headers`,
      );
    }
  }

  // Header block uses rows 1–5 so the logo never covers titles or column headers.
  const HEADER_ROW = 6;
  const DATA_START = 7;
  const bodyRowCount = Math.max(spec.rows.length, 1);
  const DATA_END = DATA_START + bodyRowCount - 1;
  const FOOTER_ROW = DATA_END + 1;

  const ws = workbook.addWorksheet(sanitizeSheetName(spec.name), {
    views: [{ state: "frozen", ySplit: HEADER_ROW, xSplit: 0, showGridLines: false }],
    properties: { defaultRowHeight: 18, tabColor: { argb: BRAND.maroon } },
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });

  // Reserve columns A–B for the logo; brand copy starts at column C.
  ws.getColumn(1).width = 14;
  ws.getColumn(2).width = 12;

  ws.addImage(imageId, {
    tl: { col: 0, row: 0 },
    ext: { width: 172, height: 50 },
    editAs: "oneCell",
  });

  ws.getRow(1).height = 22;
  ws.getRow(2).height = 22;
  ws.getRow(3).height = 18;
  ws.getRow(4).height = 14;
  ws.getRow(5).height = 6;

  // Soft brand banner behind title block (full width of table).
  for (let r = 1; r <= 4; r += 1) {
    for (let c = 1; c <= colCount; c += 1) {
      const cell = ws.getCell(r, c);
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: BRAND.softGold },
      };
      // Thin edge around the banner
      cell.border = {
        top: r === 1 ? { style: "thin", color: { argb: BRAND.bannerEdge } } : undefined,
        bottom: r === 4 ? { style: "thin", color: { argb: BRAND.bannerEdge } } : undefined,
        left: c === 1 ? { style: "thin", color: { argb: BRAND.bannerEdge } } : undefined,
        right: c === colCount ? { style: "thin", color: { argb: BRAND.bannerEdge } } : undefined,
      };
    }
  }

  const brandCell = ws.getCell(1, 3);
  ws.mergeCells(1, 3, 1, colCount);
  brandCell.value = "Anand Rathi Wealth · Gift City";
  brandCell.font = { name: "Calibri", size: 11, bold: true, color: { argb: BRAND.maroon } };
  brandCell.alignment = { vertical: "middle", horizontal: "left", wrapText: false };
  brandCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.softGold } };

  const titleCell = ws.getCell(2, 3);
  ws.mergeCells(2, 3, 2, colCount);
  titleCell.value = spec.title;
  titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: BRAND.ink } };
  titleCell.alignment = { vertical: "middle", wrapText: false };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.softGold } };

  const subCell = ws.getCell(3, 3);
  ws.mergeCells(3, 3, 3, colCount);
  subCell.value = spec.subtitle?.trim() || `Exported ${new Date().toISOString().slice(0, 10)}`;
  subCell.font = { name: "Calibri", size: 10, color: { argb: BRAND.muted } };
  subCell.alignment = { vertical: "middle", wrapText: true };
  subCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.softGold } };

  if (metaLine?.trim()) {
    const metaCell = ws.getCell(4, 3);
    ws.mergeCells(4, 3, 4, colCount);
    metaCell.value = metaLine.trim();
    metaCell.font = { name: "Calibri", size: 9, italic: true, color: { argb: BRAND.muted } };
    metaCell.alignment = { vertical: "middle", wrapText: false };
    metaCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.softGold } };
  } else {
    ws.getRow(4).height = 8;
  }

  // Gold accent rule under brand block.
  const goldRule = ws.getRow(5);
  goldRule.height = 5;
  for (let c = 1; c <= colCount; c += 1) {
    const cell = goldRule.getCell(c);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: BRAND.gold },
    };
    cell.border = {
      top: GOLD_BORDER,
      bottom: MEDIUM_MAROON,
      left: c === 1 ? MEDIUM_MAROON : undefined,
      right: c === colCount ? MEDIUM_MAROON : undefined,
    };
  }

  const headerRow = ws.getRow(HEADER_ROW);
  headerRow.height = 30;
  for (let c = 1; c <= dataCols; c += 1) {
    const cell = headerRow.getCell(c);
    cell.value = spec.headers[c - 1] ?? "";
    cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: BRAND.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.maroon } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = fullBorder(
      DOUBLE_MAROON,
      c === dataCols ? DOUBLE_MAROON : GOLD_BORDER,
      MEDIUM_MAROON,
      c === 1 ? DOUBLE_MAROON : GOLD_BORDER,
    );
  }

  const bodyRows = spec.rows.length ? spec.rows : [["No rows to export"]];
  const emptyPlaceholder = !spec.rows.length;
  bodyRows.forEach((row, i) => {
    const excelRow = ws.getRow(DATA_START + i);
    excelRow.height = 19;
    const isLast = i === bodyRows.length - 1;
    for (let c = 1; c <= dataCols; c += 1) {
      const cell = excelRow.getCell(c);
      let numericValue: number | null = null;
      if (emptyPlaceholder) {
        cell.value = c === 1 ? "No rows to export" : "";
      } else {
        const coerced = coerceCell(row[c - 1], types[c - 1] ?? "text");
        cell.value = coerced.value;
        if (coerced.numFmt) cell.numFmt = coerced.numFmt;
        if (typeof coerced.value === "number" && Number.isFinite(coerced.value)) {
          numericValue = coerced.value;
        }
      }
      const isNeg = numericValue != null && numericValue < 0;
      cell.font = {
        name: "Calibri",
        size: 10,
        color: { argb: emptyPlaceholder ? BRAND.muted : isNeg ? BRAND.neg : BRAND.ink },
        italic: emptyPlaceholder,
        bold: isNeg,
      };
      const colType = types[c - 1] ?? "text";
      const isNumeric =
        !emptyPlaceholder &&
        colType !== "text" &&
        colType !== "date";
      cell.alignment = {
        vertical: "middle",
        horizontal: emptyPlaceholder
          ? "left"
          : colType === "date"
            ? "center"
            : isNumeric
              ? "right"
              : "left",
        wrapText: false,
      };
      if (!emptyPlaceholder && i % 2 === 1) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.altRow } };
      } else if (!emptyPlaceholder) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.white } };
      }
      // Full grid; double maroon outer frame for a crisp desk look.
      cell.border = fullBorder(
        i === 0 ? MEDIUM_MAROON : GRID_BORDER,
        c === dataCols ? DOUBLE_MAROON : GRID_BORDER,
        isLast ? DOUBLE_MAROON : GRID_BORDER,
        c === 1 ? DOUBLE_MAROON : GRID_BORDER,
      );
    }
  });

  // Footer strip: row count + export stamp.
  const footer = ws.getRow(FOOTER_ROW);
  footer.height = 18;
  for (let c = 1; c <= dataCols; c += 1) {
    const cell = footer.getCell(c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.footerBg } };
    cell.border = fullBorder(
      MEDIUM_MAROON,
      c === dataCols ? DOUBLE_MAROON : GRID_BORDER,
      DOUBLE_MAROON,
      c === 1 ? DOUBLE_MAROON : GRID_BORDER,
    );
  }
  ws.mergeCells(FOOTER_ROW, 1, FOOTER_ROW, dataCols);
  const footerCell = ws.getCell(FOOTER_ROW, 1);
  const nData = emptyPlaceholder ? 0 : spec.rows.length;
  footerCell.value = `Anand Rathi Wealth · Gift City AIF · ${nData.toLocaleString("en-IN")} data row${nData === 1 ? "" : "s"} · Exported ${new Date().toISOString().slice(0, 10)}`;
  footerCell.font = { name: "Calibri", size: 8, italic: true, color: { argb: BRAND.muted } };
  footerCell.alignment = { vertical: "middle", horizontal: "left" };

  for (let c = 1; c <= dataCols; c += 1) {
    const header = String(spec.headers[c - 1] ?? "");
    let maxLen = header.length;
    for (const row of spec.rows.slice(0, 400)) {
      const v = row[c - 1];
      maxLen = Math.max(maxLen, String(v ?? "").length);
    }
    const type = types[c - 1];
    const base =
      type === "date"
        ? 13
        : type === "percent" || type === "pct_points"
          ? 12
          : type === "year"
            ? 8
          : type === "integer"
            ? 11
            : type === "currency"
              ? 16
              : 13;
    const minW = c <= 2 ? 12 : base;
    ws.getColumn(c).width = Math.min(42, Math.max(minW, Math.min(maxLen + 4, 32)));
  }

  if (spec.headers.length) {
    ws.autoFilter = {
      from: { row: HEADER_ROW, column: 1 },
      to: { row: HEADER_ROW, column: dataCols },
    };
  }

  ws.pageSetup.printArea = `A1:${colLetter(Math.max(colCount, dataCols))}${FOOTER_ROW}`;

  ws.headerFooter = {
    oddHeader: "&LAnand Rathi Wealth&CGift City AIF Forwardtester",
    oddFooter: "&C&D&RPage &P of &N",
  };
}

function colLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/** Download one or more sheets as a branded .xlsx workbook with company logo. */
export async function downloadBrandedExcel(
  filename: string,
  sheets: ExcelSheetSpec[],
  options?: { metaLine?: string },
): Promise<void> {
  if (!sheets.length) {
    throw new Error("Nothing to export");
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Anand Rathi Wealth";
  workbook.lastModifiedBy = "Gift City AIF Forwardtester";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.company = "Anand Rathi Wealth Limited";
  workbook.title = sheets[0]?.title ?? "Gift City AIF Forwardtester Export";

  const logo = await loadLogoBytes();
  const imageId = workbook.addImage({
    buffer: logo as unknown as ExcelJS.Buffer,
    extension: "png",
  });

  const usedNames = new Set<string>();
  for (const sheet of sheets) {
    let name = sanitizeSheetName(sheet.name);
    let n = 2;
    while (usedNames.has(name.toLowerCase())) {
      const suffix = ` ${n}`;
      name = sanitizeSheetName(sheet.name.slice(0, 31 - suffix.length) + suffix);
      n += 1;
    }
    usedNames.add(name.toLowerCase());
    writeSheet(workbook, imageId, { ...sheet, name }, options?.metaLine);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerBlobDownload(blob, filename);
}

/** Convenience: single-sheet branded Excel from headers + rows. */
export async function downloadExcel(
  filename: string,
  headers: string[],
  rows: CellValue[][],
  options?: {
    sheetName?: string;
    title?: string;
    subtitle?: string;
    metaLine?: string;
    columnTypes?: Array<ColumnType | undefined>;
  },
): Promise<void> {
  const title = options?.title ?? filename.replace(/\.xlsx$/i, "").replace(/\.csv$/i, "");
  await downloadBrandedExcel(
    filename,
    [
      {
        name: options?.sheetName ?? "Data",
        title,
        subtitle: options?.subtitle,
        headers,
        rows,
        columnTypes: options?.columnTypes,
      },
    ],
    { metaLine: options?.metaLine },
  );
}

/** @deprecated Prefer downloadExcel — kept for any residual callers. */
export async function downloadCsv(
  filename: string,
  headers: string[],
  rows: CellValue[][],
): Promise<void> {
  await downloadExcel(filename, headers, rows);
}

export async function downloadRowsAsExcel(
  filename: string,
  rows: Array<Record<string, CellValue>>,
  options?: { sheetName?: string; title?: string; subtitle?: string },
): Promise<void> {
  if (!rows.length) {
    await downloadExcel(filename, ["Message"], [["No rows to export"]], options);
    return;
  }
  const headers = Object.keys(rows[0]);
  await downloadExcel(
    filename,
    headers,
    rows.map((r) => headers.map((h) => r[h])),
    options,
  );
}
