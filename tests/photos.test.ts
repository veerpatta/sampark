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
    // 'a/b' has MOVED OUT of this list on purpose — see the RTE case below.
    // A dot is what makes '..' expressible, so it stays refused.
    for (const id of ["../etc", "a.b", "", "x".repeat(64), "a%2Fb"]) {
      assert.throws(() => photoPathname(id), /Unusable student id/);
    }
  });

  /**
   * NINE REAL CHILDREN. This school's RTE admission numbers are '228/12RTE'
   * and 'RTE 03', and until this was fixed every teacher asked for one of
   * their photographs got a 500 she could not get past.
   *
   * The slash must not become a folder, so it is encoded into the segment.
   */
  it("stores an id with a slash or a space, in one segment", () => {
    for (const id of ["228/12RTE", "24RTE/359", "RTE 03"]) {
      const pathname = photoPathname(id);
      assert.ok(isPhotoPathname(pathname), `not mintable: ${id}`);
      assert.ok(photoBelongsTo(pathname, id), `not owned: ${id}`);
      // One segment between 'students/' and the filename — no invented folder.
      assert.equal(pathname.split("/").length, 3, `extra segment: ${id}`);
      assert.ok(isPhotoPathname(thumbPathname(pathname)));
    }
  });

  /**
   * The identity that lets this change be safe at all: `submissions` is
   * append-only by database grant, so a pathname stored last month can never
   * be rewritten. An ordinary id has to encode to itself, or every photograph
   * already collected would stop validating.
   */
  it("leaves an ordinary id byte-identical", () => {
    assert.ok(photoPathname("S1001").startsWith("students/S1001/"));
    assert.ok(photoPathname("TMP-7").startsWith("students/TMP-7/"));
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

  it("is still a segment comparison once the id is encoded", () => {
    const other = photoPathname("228/12RTEx");
    assert.equal(photoBelongsTo(other, "228/12RTE"), false);
    assert.ok(photoBelongsTo(other, "228/12RTEx"));
  });

  /**
   * A malformed escape must be REFUSED, not thrown on. recordSubmissions calls
   * this on a value that arrived from a phone, so a URIError here would be a
   * 500 where a `false` was wanted.
   */
  it("returns false rather than throwing on a broken escape", () => {
    const day = "20260904";
    const hex = "a".repeat(24);
    for (const seg of ["%ZZ", "%", "%2", "228%2f12RTE"]) {
      assert.doesNotThrow(() =>
        assert.equal(
          photoBelongsTo(`students/${seg}/${day}-${hex}.jpg`, "228/12RTE"),
          false,
        ),
      );
    }
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
