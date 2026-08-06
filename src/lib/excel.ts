import Papa from "papaparse";
import ExcelJS from "exceljs";

/**
 * Excel and CSV reading (import) and writing (export).
 *
 * Principle 9: the office runs on Excel. Any collected dataset must come out as
 * a clean .xlsx. Reading is Phase 1; writing is Phase 4.
 *
 * PSP exports arrive as either .csv or .xlsx depending on who ran them, and the
 * office should not have to care which. Both land in the same shape here: a
 * header list plus rows of trimmed strings keyed by header. Everything becomes
 * a string deliberately — a phone number is not a number (leading zeros, and
 * 9876543210 in a float is a rounding accident waiting to happen), and a date
 * that survives as a Date is a timezone bug in the making.
 */

export type ImportRowOutcome = "insert" | "update" | "skip" | "error";

export type ImportPreviewRow = {
  rowNumber: number;
  outcome: ImportRowOutcome;
  studentId: string | null;
  matchedBy: "id" | "sr_no" | null;
  changes: Record<string, { from: string | null; to: string | null }>;
  /** Why the row is an error, when it is one. */
  message?: string;
  /**
   * Cells that were dropped, and why. A bad phone number does not fail the
   * whole row — the good cells still import and this says what did not, so
   * nothing is silently discarded.
   */
  warnings: string[];
};

export type ImportPreview = {
  rows: ImportPreviewRow[];
  counts: Record<ImportRowOutcome, number>;
};

export type ParsedTable = {
  headers: string[];
  /** One entry per data row, keyed by header. Values are trimmed strings. */
  rows: Record<string, string>[];
  /**
   * Every sheet in the workbook, and which one was read. Empty for CSV.
   *
   * The fee app exports a fifteen-sheet bundle whose first sheet is a README,
   * so "just take the first sheet" quietly reads the wrong thing. The office
   * picks.
   *
   * Optional because everything downstream of the parse works on headers and
   * rows alone — only the upload screen cares which sheet they came from.
   */
  sheets?: string[];
  sheet?: string | null;
  /** What the file turned out to actually be. Shown in the import UI. */
  format?: FileFormat;
};

export type FileFormat = "csv" | "xlsx" | "html-table";

export const FORMAT_LABEL: Record<FileFormat, string> = {
  csv: "CSV",
  xlsx: "Excel workbook",
  "html-table": "PSP report (HTML table)",
};

/** Excel serial dates are days since 1899-12-30. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/**
 * Read a file by WHAT IT IS, not what it is called.
 *
 * The PSP Student Data Entry Report downloads as `.xls` and is not an Excel
 * file at all — it is an HTML document containing one <table>, saved with the
 * wrong extension. ExcelJS throws on it, and the error it throws tells the
 * office nothing useful. So sniff the content first: a government portal is not
 * going to stop doing this because we would prefer it didn't.
 */
export async function parseTabularFile(
  data: ArrayBuffer,
  filename: string,
  sheet?: string | null,
): Promise<ParsedTable> {
  if (filename.toLowerCase().endsWith(".csv")) return parseCsv(data);
  if (looksLikeHtml(data)) return parseHtmlTable(data);
  return parseXlsx(data, sheet);
}

/**
 * Does this start like an HTML document? Checks the first bytes after any BOM
 * and leading whitespace, so `<style>…<table>` (which is exactly what PSP
 * emits) is recognised as readily as a proper `<html>`.
 */
export function looksLikeHtml(data: ArrayBuffer): boolean {
  const head = new TextDecoder("utf-8")
    .decode(data.slice(0, 1024))
    .replace(/^﻿/, "")
    .trimStart()
    .toLowerCase();

  return (
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    head.startsWith("<table") ||
    head.startsWith("<style") ||
    head.startsWith("<div")
  );
}

/**
 * Pull the first <table> out of an HTML document.
 *
 * Deliberately a small regex scanner rather than a DOM library: the input is one
 * machine-generated table with no nesting, no scripts and no user content, and
 * adding a parser dependency to read it would be a poor trade. If PSP ever
 * emits nested tables this will need replacing — it will fail loudly rather
 * than quietly, because the header row will not match anything.
 */
export function parseHtmlTable(data: ArrayBuffer): ParsedTable {
  const html = new TextDecoder("utf-8").decode(data).replace(/^﻿/, "");

  const rows: string[][] = [];
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellPattern = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;

  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    cellPattern.lastIndex = 0;
    while ((cellMatch = cellPattern.exec(rowMatch[1]!)) !== null) {
      cells.push(decodeHtml(cellMatch[1]!));
    }
    if (cells.length > 0) rows.push(cells);
  }

  const [headerRow, ...dataRows] = rows;
  if (!headerRow) {
    return { headers: [], rows: [], sheets: [], sheet: null, format: "html-table" };
  }

  const headers = dedupeHeaders(headerRow);
  const parsed = dataRows
    .map((cells) => {
      const out: Record<string, string> = {};
      headers.forEach((header, index) => {
        out[header] = cells[index] ?? "";
      });
      return out;
    })
    .filter(hasAnyValue);

  return {
    headers,
    rows: parsed,
    sheets: [],
    sheet: null,
    format: "html-table",
  };
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeHtml(cell: string): string {
  return cell
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/\s+/g, " ")
    .trim();
}

function parseCsv(data: ArrayBuffer): ParsedTable {
  const text = new TextDecoder("utf-8").decode(data).replace(/^﻿/, "");
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });

  const headers = dedupeHeaders(result.meta.fields ?? []);
  const rows = result.data.map((row) => {
    const out: Record<string, string> = {};
    for (const header of headers) out[header] = cellToString(row[header]);
    return out;
  });

  return { headers, rows: rows.filter(hasAnyValue), sheets: [], sheet: null };
}

async function parseXlsx(
  data: ArrayBuffer,
  wanted?: string | null,
): Promise<ParsedTable> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);

  const names = workbook.worksheets.map((worksheet) => worksheet.name);
  const sheet = wanted
    ? workbook.worksheets.find((worksheet) => worksheet.name === wanted)
    : workbook.worksheets[0];

  if (!sheet) return { headers: [], rows: [], sheets: names, sheet: null };

  const headerRow = sheet.getRow(1);
  const raw: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, column) => {
    raw[column - 1] = cellToString(cell.value);
  });
  const headers = dedupeHeaders(raw.map((h) => (h ?? "").trim()));

  const rows: Record<string, string>[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const out: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      out[header] = cellToString(row.getCell(index + 1).value);
    });
    if (hasAnyValue(out)) rows.push(out);
  });

  return {
    headers: headers.filter(Boolean),
    rows,
    sheets: names,
    sheet: sheet.name,
  };
}

/**
 * Duplicate or empty header names would silently overwrite each other in the
 * row objects, so give them distinct placeholders instead of losing a column.
 */
function dedupeHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const base = header.trim() || `Column ${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

function hasAnyValue(row: Record<string, string>): boolean {
  return Object.values(row).some((value) => value !== "");
}

/** Flatten every shape a spreadsheet cell can hold into a trimmed string. */
export function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return toIsoDate(value);
  if (typeof value === "number") {
    // Excel stores dates as serial numbers; the caller decides whether a given
    // column is a date, so leave the number alone here and convert at mapping
    // time via excelSerialToDate.
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value.trim();

  const object = value as Record<string, unknown>;
  if (Array.isArray(object.richText)) {
    return (object.richText as { text?: string }[])
      .map((part) => part.text ?? "")
      .join("")
      .trim();
  }
  if (typeof object.text === "string") return object.text.trim();
  if ("result" in object) return cellToString(object.result);
  if ("error" in object) return "";

  return String(value).trim();
}

/** '45000' -> '2023-03-15'. Returns null when the number is not a plausible date. */
export function excelSerialToDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 80_000) return null;
  return toIsoDate(new Date(EXCEL_EPOCH_MS + serial * 86_400_000));
}

function toIsoDate(date: Date): string {
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

/* ============================== EXPORT ================================== */

export type ExportColumn<T> = {
  header: string;
  width: number;
  value: (row: T) => string | number | null;
};

/**
 * One sheet per group, with a frozen, bold header row.
 *
 * Everything is written as text unless the column says otherwise. A phone
 * number that Excel decides is a number loses its leading zero and gains
 * scientific notation the moment the column is narrow, and the office would
 * then "fix" it by hand — which is exactly the manual Excel work this is
 * supposed to remove.
 */
export async function buildWorkbook<T>(
  sheets: { name: string; rows: T[] }[],
  columns: ExportColumn<T>[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Sampark — VPPS Data Desk";
  workbook.created = new Date();

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(safeSheetName(sheet.name));
    worksheet.columns = columns.map((column) => ({
      header: column.header,
      key: column.header,
      width: column.width,
    }));

    worksheet.getRow(1).font = { bold: true };
    worksheet.views = [{ state: "frozen", ySplit: 1 }];

    for (const row of sheet.rows) {
      worksheet.addRow(columns.map((column) => column.value(row) ?? ""));
    }

    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * Excel refuses : \ / ? * [ ] in a sheet name and caps it at 31 characters.
 * A class label like '12 Sci' is fine; this is here so a future label with a
 * slash in it fails to export rather than corrupting the file.
 */
function safeSheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, "-").trim();
  return (cleaned || "Sheet").slice(0, 31);
}

// TODO (Phase 4, blocked): exportFaMarksWorkbook(requestId) must reproduce
// FA_Marks_Pattern.xlsx exactly — header rows for school name / course type /
// exam date / total marks, then
//   Student Name | Maths | Physics | Chemistry | Biology | Science combine
// with the combine column computed. Blocked until we have that file: "matches
// the pattern" is not something that can be written from a description, and a
// near-miss means someone re-does it by hand in Excel, which is the entire
// problem this is meant to remove.
