import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fullPathname,
  hasUsablePhoto,
  inspectPhotoBytes,
  photoDefect,
  usablePhotoPath,
  MIN_PHOTO_BYTES,
} from "../src/lib/photo-health";
import { photoPathname, thumbPathname } from "../src/lib/photos";
import { completeness, TRACKED_FIELDS } from "../src/lib/completeness";
import { buildSnapshots } from "../src/lib/snapshots";
import { student } from "./helpers";
import type { FieldDef } from "../drizzle/schema";

/**
 * A pathname is not a photograph.
 *
 * The bug these lock down: an upload cut off mid-send leaves `photo_path` full
 * and nothing openable behind it, and every count in this app read that column
 * as "photographed". Those children were finished and unphotographed at once —
 * in no work list, on no round, and visible only as a broken square somebody
 * happened to scroll past.
 */

const PATH = photoPathname("S1001");

/** A complete JPEG: SOI, filler to clear the size floor, EOI. */
const whole = (bytes = MIN_PHOTO_BYTES * 2): Uint8Array => {
  const jpeg = new Uint8Array(bytes).fill(0x20);
  jpeg.set([0xff, 0xd8, 0xff, 0xe0], 0);
  jpeg.set([0xff, 0xd9], bytes - 2);
  return jpeg;
};

/** The same photograph, with the signal lost partway through sending it. */
const cutOff = (bytes = MIN_PHOTO_BYTES * 2): Uint8Array => whole(bytes).slice(0, bytes - 64);

describe("inspectPhotoBytes", () => {
  it("accepts a whole photograph", () => {
    assert.equal(inspectPhotoBytes(whole()), null);
  });

  it("catches the upload that was cut off", () => {
    // THE ONE THAT MATTERS. These bytes pass isJpeg — the SOI marker at the
    // front is intact and always will be, because the front is the half that
    // arrived. Only the missing end-of-image marker says the rest never did.
    assert.equal(inspectPhotoBytes(cutOff()), "truncated");
  });

  it("tolerates padding after the end-of-image marker", () => {
    // Some encoders pad. A complete photograph with a trailing byte must not
    // put a child back on a list to be photographed again.
    const padded = new Uint8Array(MIN_PHOTO_BYTES * 2 + 3);
    padded.set(whole(), 0);
    assert.equal(inspectPhotoBytes(padded), null);
  });

  it("refuses a stub too small to be a face", () => {
    const stub = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);
    assert.equal(inspectPhotoBytes(stub), "truncated");
  });

  it("refuses something that is not a JPEG at all", () => {
    assert.equal(inspectPhotoBytes(new TextEncoder().encode("<!doctype html>")), "not-an-image");
  });

  it("calls nothing at all missing", () => {
    assert.equal(inspectPhotoBytes(null), "missing");
    assert.equal(inspectPhotoBytes(new Uint8Array(0)), "missing");
  });
});

describe("photoDefect", () => {
  it("finds nothing wrong with a child who has no photograph", () => {
    // "No photo" is not a defect. It is the ordinary empty state, and the whole
    // point of this work is that a broken photo becomes exactly that state.
    const row = student({ id: "S1", photoPath: null, photoBrokenPath: PATH });
    assert.equal(photoDefect(row), null);
    assert.equal(hasUsablePhoto(row), false);
  });

  it("reports the mark when it names the photograph on the row", () => {
    const row = student({
      id: "S1",
      photoPath: PATH,
      photoBrokenPath: PATH,
      photoBrokenReason: "missing",
    });
    assert.equal(photoDefect(row), "missing");
    assert.equal(hasUsablePhoto(row), false);
    assert.equal(usablePhotoPath(row), null, "every screen draws this as no photo");
  });

  it("IGNORES A MARK LEFT OVER FROM THE PREVIOUS PHOTOGRAPH", () => {
    // The whole reason the mark is keyed to a pathname. A retake mints a new
    // one, so the old mark stops matching by itself — no write path anywhere
    // has to remember to clear it, and forgetting cannot leave a good
    // photograph marked broken for ever.
    const row = student({
      id: "S1",
      photoPath: photoPathname("S1001"),
      photoBrokenPath: PATH,
      photoBrokenReason: "truncated",
    });
    assert.equal(photoDefect(row), null);
    assert.equal(hasUsablePhoto(row), true);
  });

  it("still refuses the photograph when the reason is one we do not know", () => {
    // Whether it counts is decided by the pathname. A reason code added later
    // must never quietly make a broken photograph count as a good one.
    const row = student({
      id: "S1",
      photoPath: PATH,
      photoBrokenPath: PATH,
      photoBrokenReason: "something-new",
    });
    assert.equal(hasUsablePhoto(row), false);
  });
});

describe("fullPathname", () => {
  it("maps a thumbnail back to the photograph it came from", () => {
    // The board asks the proxy for thumbnails, and a mark has to land on the
    // pathname the students row actually holds.
    assert.equal(fullPathname(thumbPathname(PATH)), PATH);
    assert.equal(fullPathname(PATH), PATH);
  });
});

describe("completeness", () => {
  it("does not count a photograph that will not open", () => {
    const good = student({ id: "S1", photoPath: PATH });
    const broken = student({
      id: "S1",
      photoPath: PATH,
      photoBrokenPath: PATH,
      photoBrokenReason: "truncated",
    });
    const none = student({ id: "S1" });

    assert.equal(completeness(good).filled, 1);
    assert.equal(
      completeness(broken).filled,
      completeness(none).filled,
      "a broken photo scores exactly what no photo scores",
    );
    assert.equal(completeness(good).total, TRACKED_FIELDS.length);
  });
});

describe("buildSnapshots", () => {
  const photoField = {
    key: "photo",
    labelEn: "Photo",
    labelHi: "फ़ोटो",
    mode: "collect",
    inputType: "photo",
    targetColumn: "photo_path",
    recordKind: null,
    maxValue: null,
    exactLen: null,
    pattern: null,
    options: null,
    sortOrder: 10,
    active: true,
  } as FieldDef;

  it("freezes a broken photograph as nothing held, so the teacher is asked", () => {
    // She is standing in front of the child. Showing her a pathname that will
    // not open tells her this one is done and puts a broken square on her
    // phone; freezing it as blank asks her for a photograph instead.
    const row = student({
      id: "S1",
      photoPath: PATH,
      photoBrokenPath: PATH,
      photoBrokenReason: "missing",
    });
    const snapshots = buildSnapshots([row], [photoField], new Map());
    assert.equal(snapshots.get("S1")?.values.photo, null);
  });

  it("still freezes a photograph that opens", () => {
    const row = student({ id: "S1", photoPath: PATH });
    const snapshots = buildSnapshots([row], [photoField], new Map());
    assert.equal(snapshots.get("S1")?.values.photo, PATH);
  });
});
