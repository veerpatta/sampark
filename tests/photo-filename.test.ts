import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  matchFilename,
  placeFiles,
  sanitiseKey,
  tokensOf,
  type PhotoTarget,
} from "../src/lib/photo-filename";

/**
 * Which child a photo file is of.
 *
 * PURE, SO IT NEEDS NO DATABASE. The rule that decides this is the one place a
 * bug puts a photograph of one child on another child's record, so it is worth
 * testing exhaustively and worth testing without a connection in the way.
 */

const roster: PhotoTarget[] = [
  { studentId: "S1001", name: "Aarav Meena", classLabel: "Class 8", srNo: "4411" },
  { studentId: "S1002", name: "Priya Sharma", classLabel: "Class 8", srNo: "4412" },
  { studentId: "S1003", name: "Aarav Meena", classLabel: "Class 9", srNo: "4413" },
  { studentId: "228/12RTE", name: "Kavita Gurjar", classLabel: "Class 9", srNo: "4414" },
];

describe("tokensOf", () => {
  it("drops the extension and splits on everything that is not a letter or digit", () => {
    assert.deepEqual(tokensOf("IMG_20260903_S1001 (2).jpeg"), [
      "IMG",
      "20260903",
      "S1001",
      "2",
    ]);
  });

  it("handles a bare id", () => {
    assert.deepEqual(tokensOf("S1001.jpg"), ["S1001"]);
  });
});

describe("sanitiseKey", () => {
  it("strips the punctuation a filename cannot carry", () => {
    // Windows forbids `/` in a filename outright, so the id has to be compared
    // in a form that can survive one.
    assert.equal(sanitiseKey("228/12RTE"), "22812RTE");
    assert.equal(sanitiseKey("228 12rte"), "22812RTE");
  });
});

describe("matching one filename", () => {
  it("finds a student id as a whole token", () => {
    const match = matchFilename("S1001.jpg", roster);
    assert.equal(match.kind, "matched");
    assert.equal(match.kind === "matched" && match.studentId, "S1001");
    assert.equal(match.kind === "matched" && match.by, "id");
  });

  it("finds it inside a camera's own filename", () => {
    const match = matchFilename("IMG_20260903_S1001 (2).jpeg", roster);
    assert.equal(match.kind === "matched" && match.studentId, "S1001");
  });

  it("finds an id that a filename had to spell without its slash", () => {
    for (const filename of ["228 12RTE.jpg", "22812RTE.jpg", "228-12RTE.png"]) {
      const match = matchFilename(filename, roster);
      assert.equal(
        match.kind === "matched" && match.studentId,
        "228/12RTE",
        filename,
      );
    }
  });

  it("falls to the SR number when there is no id", () => {
    const match = matchFilename("4412.jpg", roster);
    assert.equal(match.kind === "matched" && match.studentId, "S1002");
    assert.equal(match.kind === "matched" && match.by, "sr");
  });

  it("matches a name when nothing numeric is there", () => {
    const match = matchFilename("Priya Sharma.jpg", roster);
    assert.equal(match.kind === "matched" && match.studentId, "S1002");
    assert.equal(match.kind === "matched" && match.by, "name");
  });

  /*
   * THE REFUSALS ARE THE POINT. Two children really are called Aarav Meena, in
   * two different classes, and a photograph is not recoverable from a
   * spreadsheet. More than one candidate goes to a person.
   */
  it("refuses a name that fits two children rather than guessing", () => {
    const match = matchFilename("Aarav Meena.jpg", roster);
    assert.equal(match.kind, "ambiguous");
    assert.deepEqual(
      match.kind === "ambiguous" && match.studentIds.slice().sort(),
      ["S1001", "S1003"],
    );
  });

  it("says nothing rather than something when the filename carries no clue", () => {
    assert.equal(matchFilename("DSC00042.JPG", roster).kind, "none");
    assert.equal(matchFilename("scan.png", roster).kind, "none");
  });

  it("cannot match against an empty roster", () => {
    assert.equal(matchFilename("S1001.jpg", []).kind, "none");
  });

  it("does not let an extension stand in for an SR number", () => {
    const jpgIsAnSr: PhotoTarget[] = [
      { studentId: "S9", name: "Odd Case", classLabel: "Class 8", srNo: "jpg" },
    ];
    assert.equal(matchFilename("1234.jpg", jpgIsAnSr).kind, "none");
  });
});

describe("placing a whole drop", () => {
  it("attaches each file to its own child", () => {
    const placed = placeFiles(["S1001.jpg", "S1002.jpg"], roster);
    assert.equal(placed[0]!.match.kind === "matched" && placed[0]!.match.studentId, "S1001");
    assert.equal(placed[1]!.match.kind === "matched" && placed[1]!.match.studentId, "S1002");
  });

  /*
   * A retake in the folder. Taking whichever the browser listed first would be
   * the app deciding which photograph of a child is the real one — so neither
   * is attached and a person sees both.
   */
  it("refuses both when two files claim the same child", () => {
    const placed = placeFiles(["S1001.jpg", "S1001 (1).jpg"], roster);
    assert.equal(placed[0]!.match.kind, "ambiguous");
    assert.equal(placed[1]!.match.kind, "ambiguous");
  });

  it("keeps the order the folder gave, so the tray reads the same way", () => {
    const names = ["b-S1002.jpg", "a-S1001.jpg", "zz.jpg"];
    const placed = placeFiles(names, roster);
    assert.deepEqual(
      placed.map((row) => row.filename),
      names,
    );
  });

  it("leaves an unmatched file unmatched rather than dropping it", () => {
    const placed = placeFiles(["S1001.jpg", "mystery.jpg"], roster);
    assert.equal(placed.length, 2);
    assert.equal(placed[1]!.match.kind, "none");
  });
});
