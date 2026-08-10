import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFilters, toSearchParams } from "../src/lib/student-filters";
import { completeness, TRACKED_FIELDS } from "../src/lib/completeness";
import { student } from "./helpers";

/**
 * A filtered view is a link the office sends itself, so the URL is the API.
 *
 * The two things worth locking down are that a link keeps working — bookmarks
 * to `?class=` predate every filter here — and that the board and the Excel
 * export read the same string the same way. They used not to: the export took
 * `?class=` alone, so filtering to a house and pressing Export handed over a
 * different set of children with nothing to say so.
 */

describe("parseFilters", () => {
  it("defaults to active students, in name order, a hundred at a time", () => {
    const { query, page, size, active } = parseFilters({});
    assert.equal(query.sort, "name");
    assert.equal(query.statuses?.length, 0);
    assert.equal(page, 1);
    assert.equal(size, 100);
    assert.equal(active, false, "an unfiltered board offers nothing to clear");
  });

  it("still understands the old single ?class= link", () => {
    // Bookmarks, the request builder and the student detail page all link with
    // the singular name. It joins `classes` rather than living beside it.
    const { query } = parseFilters({ class: "Class 8" });
    assert.deepEqual(query.classes, ["Class 8"]);
  });

  it("takes a repeated parameter as OR within one dimension", () => {
    const { query } = parseFilters({ houses: ["Rana Pratap", "Rana Sanga"] });
    assert.deepEqual(query.houses, ["Rana Pratap", "Rana Sanga"]);
  });

  it("combines dimensions, which is AND across them", () => {
    const { query, active } = parseFilters({
      classes: ["Class 8"],
      houses: ["Rana Pratap"],
      missing: "phone",
    });
    assert.deepEqual(query.classes, ["Class 8"]);
    assert.deepEqual(query.houses, ["Rana Pratap"]);
    assert.deepEqual(query.missing, ["phone"]);
    assert.equal(active, true);
  });

  it("drops a missing-field name it does not recognise", () => {
    // Straight off the query string, so it is whatever somebody typed. An
    // unknown key must narrow nothing rather than reach the SQL builder.
    const { query } = parseFilters({ missing: ["phone", "bank_account"] });
    assert.deepEqual(query.missing, ["phone"]);
  });

  it("falls back on a sort or page size it does not recognise", () => {
    const { query, size } = parseFilters({ sort: "sideways", size: "999" });
    assert.equal(query.sort, "name");
    assert.equal(size, 100);
  });

  it("turns the page number into an offset the query can use", () => {
    const { query, page } = parseFilters({ page: "3", size: "50" });
    assert.equal(page, 3);
    assert.equal(query.limit, 50);
    assert.equal(query.offset, 100);
  });

  it("refuses a page number below one", () => {
    assert.equal(parseFilters({ page: "0" }).page, 1);
    assert.equal(parseFilters({ page: "-4" }).page, 1);
    assert.equal(parseFilters({ page: "banana" }).page, 1);
  });
});

describe("toSearchParams", () => {
  it("carries every filter, so the export matches the board", () => {
    const params = {
      q: "meena",
      houses: ["Rana Pratap", "Rana Sanga"],
      missing: "phone",
      sort: "complete",
    };
    const search = toSearchParams(params);
    assert.deepEqual(search.getAll("houses"), ["Rana Pratap", "Rana Sanga"]);
    assert.equal(search.get("q"), "meena");
    assert.equal(search.get("missing"), "phone");
    assert.equal(search.get("sort"), "complete");
  });

  it("leaves page one out of the link entirely", () => {
    assert.equal(toSearchParams({}, { page: 1 }).get("page"), null);
    assert.equal(toSearchParams({}, { page: 2 }).get("page"), "2");
  });

  it("does not carry the current page into the export link", () => {
    // Exporting page 3 of a filtered board must give the whole filtered set,
    // not the hundred rows that happen to be on screen.
    const search = toSearchParams({ page: "3", classes: "Class 8" });
    assert.equal(search.get("page"), null);
    assert.equal(search.get("classes"), "Class 8");
  });
});

describe("completeness", () => {
  it("counts an empty record as nothing held", () => {
    const result = completeness(student({ id: "S1" }));
    assert.equal(result.filled, 0);
    assert.equal(result.total, TRACKED_FIELDS.length);
    assert.equal(result.percent, 0);
  });

  it("counts a filled field once", () => {
    const result = completeness(
      student({ id: "S1", phone: "9876543210", house: "Rana Pratap" }),
    );
    assert.equal(result.filled, 2);
  });

  it("treats whitespace as a hole", () => {
    // Imports have produced both NULL and ''. A record that looks full and is
    // not is worse than one that is honestly empty.
    assert.equal(completeness(student({ id: "S1", phone: "   " })).filled, 0);
  });

  it("does NOT let a masked Aadhaar count as an Aadhaar", () => {
    // PSP gives the last four digits for 328 of 504 children. Counting that
    // would make the school look finished on the one field it holds none of.
    const masked = student({ id: "S1", aadhaarLast4: "1234" });
    assert.equal(completeness(masked).filled, 0);
  });
});
