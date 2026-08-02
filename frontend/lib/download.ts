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

/** Desk tokens — mirror Primary SP Dashboard `lib/workbook/export-theme.ts`. */
const BRAND = {
  maroon: "FF7A1E2C",
  maroonDeep: "FF5C1622",
  gold: "FFD4B24C",
  goldSoft: "FFF6EDCF",
  goldPale: "FFFCF8EE",
  ivory: "FFFAF7EF",
  parchment: "FFF8F4EA",
  muted: "FF78716C",
  ink: "FF1C1917",
  white: "FFFFFFFF",
  border: "FFE7E1CF",
  rule: "FFC9B88A",
  neg: "FF9B1C2C",
  footerBg: "FFF8F4EA",
} as const;

const EXCEL_FONT = "Calibri";
const DESK_EYEBROW = "Anand Rathi Wealth · Gift City AIF Forwardtester";

type BorderEdge = { style: "thin" | "medium" | "hair"; color: { argb: string } };

const GOLD_BORDER: BorderEdge = { style: "thin", color: { argb: BRAND.gold } };
const GRID_BORDER: BorderEdge = { style: "thin", color: { argb: BRAND.border } };
const RULE_BORDER: BorderEdge = { style: "thin", color: { argb: BRAND.rule } };

function fullBorder(
  top: BorderEdge = GRID_BORDER,
  right: BorderEdge = GRID_BORDER,
  bottom: BorderEdge = GRID_BORDER,
  left: BorderEdge = GRID_BORDER,
) {
  return { top, right, bottom, left };
}

const goldBox = fullBorder(GOLD_BORDER, GOLD_BORDER, GOLD_BORDER, GOLD_BORDER);

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

  // Primary SP layout: logo wash (3) + masthead + spacer → column headers.
  // Rows: 1–3 logo · 4 gold rule · 5 title · 6 subtitle · 7 eyebrow · 8 spacer · 9 headers
  const LOGO_ROWS = 3;
  const HEADER_ROW = LOGO_ROWS + 6;
  const DATA_START = HEADER_ROW + 1;
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

  // Soft parchment wash behind logo (Primary SP embedBrandLogo).
  for (let r = 1; r <= LOGO_ROWS; r += 1) {
    ws.getRow(r).height = r === 1 ? 30 : r === 2 ? 18 : 6;
    for (let c = 1; c <= colCount; c += 1) {
      const cell = ws.getCell(r, c);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.goldPale } };
    }
  }
  ws.addImage(imageId, {
    tl: { col: 0, row: 0 },
    ext: { width: 210, height: 48 },
    editAs: "oneCell",
  });

  const paintSpan = (
    row: number,
    value: string,
    opts: {
      fill: string;
      font: Partial<ExcelJS.Font>;
      height: number;
      indent?: number;
    },
  ) => {
    ws.mergeCells(row, 1, row, colCount);
    const cell = ws.getCell(row, 1);
    cell.value = value;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } };
    cell.font = { name: EXCEL_FONT, ...opts.font };
    cell.alignment = {
      vertical: "middle",
      horizontal: "left",
      indent: opts.indent ?? 1,
      wrapText: true,
    };
    for (let c = 1; c <= colCount; c += 1) {
      ws.getCell(row, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } };
    }
    ws.getRow(row).height = opts.height;
  };

  // Gold accent rule
  const ruleRow = LOGO_ROWS + 1;
  ws.mergeCells(ruleRow, 1, ruleRow, colCount);
  for (let c = 1; c <= colCount; c += 1) {
    const cell = ws.getCell(ruleRow, c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.gold } };
  }
  ws.getRow(ruleRow).height = 5;

  // Maroon deep title band
  paintSpan(LOGO_ROWS + 2, spec.title, {
    fill: BRAND.maroonDeep,
    font: { bold: true, size: 18, color: { argb: BRAND.white } },
    height: 36,
  });

  // Gold subtitle strip
  const exportDay = (() => {
    const n = new Date();
    const iso = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
    return formatDeskDate(iso);
  })();
  paintSpan(LOGO_ROWS + 3, spec.subtitle?.trim() || `Exported ${exportDay}`, {
    fill: BRAND.gold,
    font: { bold: true, size: 10, color: { argb: BRAND.ink } },
    height: 22,
  });

  // Parchment eyebrow
  paintSpan(LOGO_ROWS + 4, metaLine?.trim() || DESK_EYEBROW, {
    fill: BRAND.parchment,
    font: { size: 8, italic: true, color: { argb: BRAND.muted } },
    height: 16,
  });
  ws.getCell(LOGO_ROWS + 4, 1).border = { bottom: RULE_BORDER };

  // Breathing room
  const spacerRow = LOGO_ROWS + 5;
  ws.getRow(spacerRow).height = 8;
  for (let c = 1; c <= colCount; c += 1) {
    ws.getCell(spacerRow, c).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: BRAND.parchment },
    };
  }

  const headerRow = ws.getRow(HEADER_ROW);
  headerRow.height = 26;
  for (let c = 1; c <= dataCols; c += 1) {
    const cell = headerRow.getCell(c);
    cell.value = spec.headers[c - 1] ?? "";
    cell.font = { name: EXCEL_FONT, size: 10, bold: true, color: { argb: BRAND.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.maroonDeep } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true, indent: 1 };
    cell.border = goldBox;
  }

  const bodyRows = spec.rows.length ? spec.rows : [["No rows to export"]];
  const emptyPlaceholder = !spec.rows.length;
  bodyRows.forEach((row, i) => {
    const excelRow = ws.getRow(DATA_START + i);
    excelRow.height = 19;
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
        name: EXCEL_FONT,
        size: 10,
        color: { argb: emptyPlaceholder ? BRAND.muted : isNeg ? BRAND.neg : BRAND.ink },
        italic: emptyPlaceholder,
        bold: isNeg,
      };
      const colType = types[c - 1] ?? "text";
      const isNumeric = !emptyPlaceholder && colType !== "text" && colType !== "date";
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
        indent: isNumeric || colType === "date" ? 0 : 1,
      };
      if (!emptyPlaceholder && i % 2 === 1) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.ivory } };
      } else if (!emptyPlaceholder) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.white } };
      }
      cell.border = goldBox;
    }
  });

  const footer = ws.getRow(FOOTER_ROW);
  footer.height = 18;
  for (let c = 1; c <= dataCols; c += 1) {
    const cell = footer.getCell(c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.footerBg } };
    cell.border = fullBorder(RULE_BORDER, RULE_BORDER, RULE_BORDER, RULE_BORDER);
  }
  ws.mergeCells(FOOTER_ROW, 1, FOOTER_ROW, dataCols);
  const footerCell = ws.getCell(FOOTER_ROW, 1);
  const nData = emptyPlaceholder ? 0 : spec.rows.length;
  footerCell.value = `Anand Rathi Wealth · Gift City AIF · ${nData.toLocaleString("en-IN")} data row${nData === 1 ? "" : "s"} · Exported ${exportDay}`;
  footerCell.font = { name: EXCEL_FONT, size: 8, italic: true, color: { argb: BRAND.muted } };
  footerCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };

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
    ws.getColumn(c).width = Math.min(42, Math.max(base, Math.min(maxLen + 4, 32)));
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
