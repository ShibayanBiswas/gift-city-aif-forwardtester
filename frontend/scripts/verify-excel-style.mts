import ExcelJS from "exceljs";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { downloadBrandedExcel } from "../lib/download";

function installBrowserMocks(outPath: string): Promise<Buffer> {
  const g = globalThis as typeof globalThis & {
    document: { createElement: (tag: string) => { click: () => void; href: string; download: string } };
    URL: { createObjectURL: (blob: Blob) => string; revokeObjectURL: () => void };
    fetch: (url: string) => Promise<{ ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }>;
  };

  let resolveBlob: (b: Buffer) => void;
  const blobReady = new Promise<Buffer>((resolve) => {
    resolveBlob = resolve;
  });

  g.document = {
    createElement: () => ({
      click() {},
      href: "",
      download: "",
    }),
  };
  g.URL = {
    createObjectURL: (blob: Blob) => {
      void blob.arrayBuffer().then((ab) => {
        const buf = Buffer.from(ab);
        writeFileSync(outPath, buf);
        resolveBlob(buf);
      });
      return "blob:test";
    },
    revokeObjectURL: () => {},
  };
  g.fetch = async (url: string) => {
    if (String(url).includes("brand") || String(url).includes("logo")) {
      try {
        const b = readFileSync(new URL("../public/brand/arwl-logo.png", import.meta.url));
        return {
          ok: true,
          arrayBuffer: async () =>
            b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer,
        };
      } catch {
        const tiny = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          "base64",
        );
        return {
          ok: true,
          arrayBuffer: async () =>
            tiny.buffer.slice(tiny.byteOffset, tiny.byteOffset + tiny.byteLength) as ArrayBuffer,
        };
      }
    }
    return { ok: false, arrayBuffer: async () => new ArrayBuffer(0) };
  };

  return blobReady;
}

function describeBorder(cell: ExcelJS.Cell) {
  return {
    top: cell.border?.top?.style,
    left: cell.border?.left?.style,
    right: cell.border?.right?.style,
    bottom: cell.border?.bottom?.style,
    fill: (cell.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb,
  };
}

function assertBorders(ws: ExcelJS.Worksheet, headerRow: number, dataRow: number, footerRow: number, cols: number) {
  const header = ws.getRow(headerRow).getCell(1);
  const data = ws.getRow(dataRow).getCell(1);
  const footer = ws.getRow(footerRow).getCell(1);
  const headerFill = (header.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb?.toUpperCase() ?? "";

  const ok =
    (header.border?.top?.style === "thin" || header.border?.top?.style === "medium") &&
    (headerFill.includes("5C1622") || headerFill.includes("7A1E2C")) &&
    !!data.border?.top?.style &&
    !!data.border?.left?.style &&
    !!data.border?.right?.style &&
    !!data.border?.bottom?.style &&
    String(footer.value || "").includes("data row");

  if (!ok) {
    console.error("border check failed", {
      header: describeBorder(header),
      data: describeBorder(data),
      footer: String(footer.value),
      cols,
    });
    throw new Error("STYLE_FAIL borders");
  }
}

async function main() {
  const outPath = join(tmpdir(), "gift_aif_style_sample.xlsx");
  mkdirSync(tmpdir(), { recursive: true });
  const blobReady = installBrowserMocks(outPath);

  await downloadBrandedExcel(
    "style-sample.xlsx",
    [
      {
        name: "Yearly Rollup",
        title: "Yearly Rollup Since 2001",
        subtitle: "Mean, Median, Extremes, IRR, And Hit Rate By Start Year",
        headers: [
          "Start Year",
          "Number Of Paths",
          "Mean Terminal In Crores",
          "Median Terminal In Crores",
          "Minimum Terminal In Crores",
          "Maximum Terminal In Crores",
          "Mean IRR %",
          "Share Above 100 Crores %",
        ],
        columnTypes: ["year", "integer", "currency", "currency", "currency", "currency", "pct_points", "pct_points"],
        rows: [
          [2001, 12, 180.772, 175.5, 160.2, 216.473, 15.743, 100],
          [2002, 11, 172.331, 168.1, 155.0, 205.2, 14.221, 90.909],
        ],
      },
      {
        name: "Path Summary",
        title: "Path Summary Since 2001",
        headers: ["Path Number", "Start Date", "Terminal Total", "Internal Rate Of Return"],
        columnTypes: ["integer", "date", "currency", "percent"],
        rows: [[1, "2001-01-01", 180.7724, 0.15743]],
      },
      {
        name: "Result",
        title: "Path Result · 1",
        subtitle: "Style QA · bordered desk table",
        headers: ["Component", "Value (Cr)", "Date"],
        columnTypes: ["text", "currency", "date"],
        rows: [
          ["Investment", 100, "2001-01-01"],
          ["MTM Futures", 48.8223346611, "2001-01-02"],
          ["Fees", -7.495890411, "2001-01-05"],
        ],
      },
    ],
    { metaLine: "Final style verification" },
  );

  const buf = await blobReady;
  console.log("wrote", buf.length, "bytes →", outPath);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(outPath);
  console.log("sheets", wb.worksheets.map((w) => w.name));

  const yearly = wb.getWorksheet("Yearly Rollup")!;
  // Primary SP masthead: header row 9, data 10+, footer after body
  assertBorders(yearly, 9, 10, 12, 8);

  const yearCell = yearly.getRow(10).getCell(1);
  const meanCell = yearly.getRow(10).getCell(3);
  const irrCell = yearly.getRow(10).getCell(7);
  const hitCell = yearly.getRow(10).getCell(8);

  if (yearCell.numFmt !== "0") {
    throw new Error(`STYLE_FAIL year fmt: ${yearCell.numFmt}`);
  }
  if (String(yearCell.value) === "2,001" || /,\d{3}/.test(String(yearCell.text ?? ""))) {
    throw new Error(`STYLE_FAIL year has thousand separator: value=${yearCell.value} text=${yearCell.text}`);
  }
  if (meanCell.numFmt !== '#,##0.000" Cr"') {
    throw new Error(`STYLE_FAIL currency fmt: ${meanCell.numFmt}`);
  }
  if (irrCell.numFmt !== '0.000"%"') {
    throw new Error(`STYLE_FAIL pct_points fmt: ${irrCell.numFmt}`);
  }
  if (hitCell.numFmt !== '0.000"%"') {
    throw new Error(`STYLE_FAIL hit rate fmt: ${hitCell.numFmt}`);
  }
  if (meanCell.alignment?.horizontal !== "right") {
    throw new Error(`STYLE_FAIL currency alignment: ${meanCell.alignment?.horizontal}`);
  }

  const summary = wb.getWorksheet("Path Summary")!;
  assertBorders(summary, 9, 10, 11, 4);
  const irrRatio = summary.getRow(10).getCell(4);
  if (irrRatio.numFmt !== "0.00%") {
    throw new Error(`STYLE_FAIL percent fmt: ${irrRatio.numFmt}`);
  }

  const result = wb.getWorksheet("Result")!;
  assertBorders(result, 9, 10, 13, 3);

  // Masthead tokens must match Primary SP Dashboard
  const titleFill = (yearly.getRow(5).getCell(1).fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb?.toUpperCase() ?? "";
  const goldRule = (yearly.getRow(4).getCell(1).fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb?.toUpperCase() ?? "";
  if (!titleFill.includes("5C1622")) throw new Error(`STYLE_FAIL title band: ${titleFill}`);
  if (!goldRule.includes("D4B24C")) throw new Error(`STYLE_FAIL gold rule: ${goldRule}`);

  console.log("STYLE_PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
