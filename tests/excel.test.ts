import { test, describe } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildWorkbook, looksLikeHtml, parseHtmlTable } from "../src/lib/excel";

/**
 * The PSP report downloads as `.xls` and is not an Excel file — it is an HTML
 * document with one <table>, saved with the wrong extension. ExcelJS throws on
 * it with an error that tells the office nothing.
 *
 * A government portal is not going to stop doing this because we would prefer
 * it didn't, so read files by what they are rather than what they are called.
 */

const encode = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe("looksLikeHtml", () => {
  test("recognises what PSP actually sends", () => {
    // The real first bytes: a <style> block, then a <div>, then the table.
    assert.equal(looksLikeHtml(encode('<style> .textmode { } </style><div>\n\t<table>')), true);
  });

  test("recognises an ordinary HTML document", () => {
    assert.equal(looksLikeHtml(encode("<!DOCTYPE html><html><body>")), true);
    assert.equal(looksLikeHtml(encode("<table><tr><td>x</td></tr></table>")), true);
  });

  test("sees past a byte-order mark and leading whitespace", () => {
    assert.equal(looksLikeHtml(encode("﻿\n  <html>")), true);
  });

  test("does not mistake a real spreadsheet for HTML", () => {
    // A .xlsx is a zip: 'PK' then two control bytes.
    assert.equal(looksLikeHtml(encode("PKrest-of-the-zip")), false);
  });

  test("does not mistake a CSV for HTML", () => {
    assert.equal(looksLikeHtml(encode("Name,Class\nAaaa,Class 8")), false);
  });
});

describe("parseHtmlTable", () => {
  test("reads the header row and the data rows", () => {
    const table = parseHtmlTable(
      encode(`<table>
        <tr><td>SR No.</td><td>Student Name</td></tr>
        <tr><td>ZZ-1</td><td>AAAA BBBB</td></tr>
        <tr><td>ZZ-2</td><td>CCCC DDDD</td></tr>
      </table>`),
    );

    assert.deepEqual(table.headers, ["SR No.", "Student Name"]);
    assert.equal(table.rows.length, 2);
    assert.equal(table.rows[0]!["Student Name"], "AAAA BBBB");
    assert.equal(table.format, "html-table");
  });

  test("handles <th> headers and nested markup inside a cell", () => {
    const table = parseHtmlTable(
      encode(`<table>
        <tr><th>Name</th></tr>
        <tr><td><span class="x">AAAA</span> <b>BBBB</b></td></tr>
      </table>`),
    );
    assert.equal(table.rows[0]!.Name, "AAAA BBBB");
  });

  test("decodes entities so a name is not mangled", () => {
    const table = parseHtmlTable(
      encode(`<table><tr><td>Name</td></tr><tr><td>A&amp;B&nbsp;C</td></tr></table>`),
    );
    assert.equal(table.rows[0]!.Name, "A&B C");
  });

  test("drops entirely empty rows", () => {
    const table = parseHtmlTable(
      encode(`<table>
        <tr><td>Name</td></tr>
        <tr><td>AAAA</td></tr>
        <tr><td></td></tr>
      </table>`),
    );
    assert.equal(table.rows.length, 1);
  });

  test("a table with no rows is empty, not an exception", () => {
    const table = parseHtmlTable(encode("<div>no table here</div>"));
    assert.deepEqual(table.headers, []);
    assert.deepEqual(table.rows, []);
  });
});

describe("buildWorkbook — photographs in cells", () => {
  /**
   * The office wanted a printed class list with faces on it and kept getting a
   * column that said "yes". A blob pathname is a dead string in a spreadsheet
   * and "yes" answers a different question, so the cell holds the picture.
   *
   * Read back through ExcelJS rather than asserting on the bytes we passed in:
   * addImage is easy to call in a way that produces a valid file with the
   * picture anchored outside the sheet, and only a reader catches that.
   */
  const JPEG = Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
      "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
      "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
    "base64",
  );

  type Row = { id: string; photo: Buffer | null };

  const columns = [
    { header: "Student ID", width: 14, value: (r: Row) => r.id },
    {
      header: "Photo",
      width: 11,
      value: (r: Row) => (r.photo ? "" : "no photo"),
      image: (r: Row) => r.photo,
    },
  ];

  async function build(rows: Row[]) {
    const file = await buildWorkbook([{ name: "Class 8", rows }], columns);
    const read = new ExcelJS.Workbook();
    await read.xlsx.load(
      file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
    );
    return read.getWorksheet("Class 8")!;
  }

  test("puts the picture in the cell, on the row it belongs to", async () => {
    const sheet = await build([
      { id: "S1", photo: JPEG },
      { id: "S2", photo: JPEG },
    ]);

    const images = sheet.getImages();
    assert.equal(images.length, 2, "both faces should be in the sheet");

    // Column index 1 is Photo; row 1 is the first DATA row, because the anchor
    // grid is zero-based and row 0 is the frozen header.
    const rowsAnchored = images.map((image) => image.range.tl.nativeRow).sort();
    assert.deepEqual(rowsAnchored, [1, 2]);
    for (const image of images) {
      assert.equal(image.range.tl.nativeCol, 1, "a face landed outside the Photo column");
    }
  });

  test("grows only the rows that carry a picture", async () => {
    const sheet = await build([
      { id: "S1", photo: JPEG },
      { id: "S2", photo: null },
    ]);

    // Row 1 is the header, so the data starts at 2.
    assert.ok((sheet.getRow(2).height ?? 0) > 20, "the photo row was left too short to see it");
    assert.equal(sheet.getRow(3).height, undefined, "a class with no photos should read as a normal table");
  });

  test("says so in words when there is no photograph", async () => {
    const sheet = await build([{ id: "S1", photo: null }]);
    assert.equal(sheet.getImages().length, 0);
    assert.equal(sheet.getRow(2).getCell(2).value, "no photo");
  });
});
