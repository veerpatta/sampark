import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DOCUMENT_KINDS,
  documentBelongsTo,
  documentKindLabel,
  documentPathname,
  isDocumentKind,
  isDocumentPathname,
  sniffDocument,
} from "../src/lib/documents";

/**
 * The pathname rules are a security control, not a format preference — see the
 * header of lib/documents.ts. Each of these is a way a scan of one child's
 * Aadhaar card could end up on another child's record, or an HTML page could be
 * served as a PDF.
 */
describe("document pathnames", () => {
  it("mints a pathname under the child's own segment, and it validates", () => {
    const pathname = documentPathname("S1001", "pdf", new Date("2026-09-03T02:00:00Z"));
    assert.match(pathname, /^documents\/S1001\/20260903-[0-9a-f]{24}\.pdf$/);
    assert.ok(isDocumentPathname(pathname));
    assert.ok(documentBelongsTo(pathname, "S1001"));
  });

  it("never mints twice the same", () => {
    assert.notEqual(documentPathname("S1", "jpg"), documentPathname("S1", "jpg"));
  });

  it("refuses an id that could not be a path segment", () => {
    assert.throws(() => documentPathname("../S1", "pdf"));
    assert.throws(() => documentPathname("S1/S2", "pdf"));
  });

  it("compares the segment, not the prefix", () => {
    // `documents/S1001x/...`.startsWith("documents/S1001") is true, and that
    // one character is one child's certificate on another child's record.
    const other = documentPathname("S1001x", "jpg");
    assert.equal(documentBelongsTo(other, "S1001"), false);
    assert.equal(documentBelongsTo(other, "S1001x"), true);
  });

  it("accepts only the three extensions, lower case", () => {
    const hex = "0".repeat(24);
    assert.ok(isDocumentPathname(`documents/S1/20260903-${hex}.png`));
    assert.equal(isDocumentPathname(`documents/S1/20260903-${hex}.jpeg`), false);
    assert.equal(isDocumentPathname(`documents/S1/20260903-${hex}.PDF`), false);
    assert.equal(isDocumentPathname(`students/S1/20260903-${hex}.jpg`), false);
    assert.equal(isDocumentPathname(null), false);
  });
});

describe("sniffDocument", () => {
  const bytes = (...head: number[]) => new Uint8Array([...head, 0, 0, 0, 0, 0, 0, 0, 0]);

  it("reads the magic bytes, not the file name", () => {
    assert.deepEqual(sniffDocument(bytes(0xff, 0xd8, 0xff, 0xe0)), { ext: "jpg", contentType: "image/jpeg" });
    assert.deepEqual(sniffDocument(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), { ext: "png", contentType: "image/png" });
    assert.deepEqual(sniffDocument(new TextEncoder().encode("%PDF-1.4\n%âãÏÓ\n1 0 obj")), { ext: "pdf", contentType: "application/pdf" });
  });

  it("refuses anything else, including an HTML page wearing a .pdf name", () => {
    assert.equal(sniffDocument(new TextEncoder().encode("<html><body>pdf</body></html>")), null);
    assert.equal(sniffDocument(new Uint8Array([0x25, 0x50])), null);
    assert.equal(sniffDocument(new Uint8Array()), null);
  });
});

describe("document kinds", () => {
  it("has a label for every kind and refuses an unknown one", () => {
    for (const kind of DOCUMENT_KINDS) {
      assert.ok(isDocumentKind(kind.key));
      assert.equal(documentKindLabel(kind.key), kind.label);
    }
    assert.equal(isDocumentKind("passport"), false);
    assert.equal(documentKindLabel("passport"), "passport");
  });
});
