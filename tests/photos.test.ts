import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isJpeg,
  isPhotoPathname,
  photoBelongsTo,
  photoPathname,
  thumbPathname,
} from "../src/lib/photos";

/**
 * The pathname is the whole security boundary for photographs.
 *
 * A photo travels as a string, and that string decides which child's record a
 * face lands on. Everything here is checking that a string somebody else wrote
 * cannot pass for one this app minted.
 */

const MINE = photoPathname("S1001");

describe("photoPathname", () => {
  it("mints something its own validator accepts", () => {
    assert.ok(isPhotoPathname(MINE));
    assert.ok(MINE.startsWith("students/S1001/"));
    assert.ok(MINE.endsWith(".jpg"));
  });

  it("is different every time", () => {
    // The randomness is what makes a private blob's path unguessable even to
    // somebody who knows the student id and the date.
    assert.notEqual(photoPathname("S1001"), photoPathname("S1001"));
  });

  it("refuses a student id that would escape its own folder", () => {
    for (const id of ["../etc", "a/b", "", "x".repeat(64)]) {
      assert.throws(() => photoPathname(id), /Unusable student id/);
    }
  });
});

describe("isPhotoPathname", () => {
  it("accepts the thumbnail variant", () => {
    assert.ok(isPhotoPathname(thumbPathname(MINE)));
  });

  it("refuses anything this app did not mint", () => {
    const rejected = [
      "../../etc/passwd",
      "/students/S1001/20260810-aaaaaaaaaaaaaaaaaaaaaaaa.jpg",
      "students/S1001/20260810-aaaaaaaaaaaaaaaaaaaaaaaa.png",
      "students/S1001/20260810-nothex000000000000000000.jpg",
      "students/S1001/2026-aaaaaaaaaaaaaaaaaaaaaaaa.jpg",
      // A slash inside the student segment is the traversal that matters.
      "students/S1001/../S1002/20260810-aaaaaaaaaaaaaaaaaaaaaaaa.jpg",
      "students//20260810-aaaaaaaaaaaaaaaaaaaaaaaa.jpg",
      // A full URL is the shape we deliberately do NOT store.
      "https://x.public.blob.vercel-storage.com/students/S1001/a.jpg",
      "",
      null,
      undefined,
      42,
    ];
    for (const value of rejected) {
      assert.equal(isPhotoPathname(value), false, `accepted ${String(value)}`);
    }
  });
});

describe("photoBelongsTo", () => {
  it("says yes to its own student", () => {
    assert.ok(photoBelongsTo(MINE, "S1001"));
  });

  it("says no to another child on the same roster", () => {
    assert.equal(photoBelongsTo(MINE, "S1002"), false);
  });

  /**
   * THE TEST THAT MATTERS. A naive `startsWith("students/" + id)` returns true
   * here, and that one character is one child's photograph on another child's
   * record — a mistake nobody would ever spot in the review queue, because the
   * face shown IS a face from that class.
   */
  it("is a segment comparison, not a prefix match", () => {
    const other = photoPathname("S1001x");
    assert.equal(photoBelongsTo(other, "S1001"), false);
    assert.ok(other.startsWith("students/S1001"), "the trap is still live");
  });

  it("says no to a string that is not a pathname at all", () => {
    assert.equal(photoBelongsTo("students/S1001/hello.jpg", "S1001"), false);
    assert.equal(photoBelongsTo(null, "S1001"), false);
  });
});

describe("isJpeg", () => {
  const bytes = (...values: number[]) => new Uint8Array(values);

  it("accepts the JPEG start-of-image marker", () => {
    assert.ok(isJpeg(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00)));
  });

  it("refuses everything else the browser might send", () => {
    // PNG, GIF, an SVG, an HTML page, and nothing at all. The content type the
    // client declares is not evidence; these three bytes are.
    assert.equal(isJpeg(bytes(0x89, 0x50, 0x4e, 0x47)), false);
    assert.equal(isJpeg(bytes(0x47, 0x49, 0x46, 0x38)), false);
    assert.equal(isJpeg(new TextEncoder().encode("<svg xmlns=")), false);
    assert.equal(isJpeg(new TextEncoder().encode("<!doctype html>")), false);
    assert.equal(isJpeg(bytes()), false);
    assert.equal(isJpeg(bytes(0xff, 0xd8)), false);
  });
});
