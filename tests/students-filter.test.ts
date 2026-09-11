import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  describeGaps,
  MISSING_FIELDS,
  MISSING_LABELS,
  MISSING_LABELS_HI,
  parseFilters,
  toSearchParams,
} from "../src/lib/student-filters";
import type { MissingField } from "../src/lib/students";
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

/** The four that are not one column being empty. */
const PHONE_GAPS: MissingField[] = [
  "altPhone",
  "onlyOnePhone",
  "samePhones",
  "notOnWhatsapp",
];

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

  it("re-sorts the same view from a header link, and drops the page", () => {
    const search = toSearchParams({ page: "3", classes: "Class 8", sort: "complete" }, { sort: "fullest" });
    assert.equal(search.get("sort"), "fullest");
    assert.equal(search.get("classes"), "Class 8");
    assert.equal(search.get("page"), null);
    // The default order is no parameter at all, so the plain URL stays plain.
    assert.equal(toSearchParams({ sort: "complete" }, { sort: "name" }).get("sort"), null);
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

/**
 * The four filters that are not "a column is blank".
 *
 * They are why MISSING_COLUMNS holds a predicate rather than a column, and the
 * two things worth pinning are that the URL still carries them like any other
 * and that nothing about them has leaked into the completeness score.
 */
describe("the phone-shape filters", () => {
  it("carries all four through a URL like any other hole", () => {
    for (const gap of PHONE_GAPS) {
      const { query, active } = parseFilters({ missing: gap });
      assert.deepEqual(query.missing, [gap], `${gap} survived parseFilters`);
      assert.equal(active, true);
      assert.equal(
        toSearchParams({ missing: gap }).getAll("missing").join(),
        gap,
        `${gap} survived the round trip back into a link`,
      );
    }
  });

  it("names every hole in both languages", () => {
    // The English half is read by the office; the Hindi half now reaches a
    // teacher's WhatsApp and the top of her screen. A filter that shipped with
    // only one of them would send her a blank where the reason should be.
    for (const gap of MISSING_FIELDS) {
      assert.ok(MISSING_LABELS[gap], `${gap} has an English label`);
      assert.ok(MISSING_LABELS_HI[gap], `${gap} has a Hindi label`);
    }
  });

  it("keeps Devanagari numerals out of the Hindi labels", () => {
    // The same rule every teacher-facing string in this app is held to: the
    // school reads roll numbers in Latin, and ११ is unreadable on a due date.
    for (const label of Object.values(MISSING_LABELS_HI)) {
      assert.ok(!/[०-९]/.test(label), `"${label}" carries a Devanagari numeral`);
    }
  });

  /*
   * THE INVARIANT THAT USED TO BE A PAIR AND IS NOW ONE-WAY.
   *
   * Every tracked field still has a filter, which is what makes every cell of
   * the data-health heatmap a link. The reverse no longer holds, and must not:
   * a second phone number appearing in the completeness bar would move five
   * hundred children's scores for something the school does not consider owed.
   */
  it("keeps every tracked field reachable as a filter", () => {
    for (const field of TRACKED_FIELDS) {
      assert.ok(
        MISSING_FIELDS.some((gap) => MISSING_LABELS[gap]),
        `${field} must stay filterable`,
      );
    }
  });

  it("keeps the phone-shape filters out of the completeness score", () => {
    const empty = completeness(student({ id: "ZZ1" }));
    const both = completeness(
      student({ id: "ZZ2", phone: "9111111111", altPhone: "9111111111" }),
    );
    // A second number does not raise the score, so neither can a filter about
    // the shape of one. TRACKED_FIELDS is the list that decides it.
    assert.equal(
      both.filled - empty.filled,
      1,
      "a second number must not count as a second field filled",
    );
    for (const gap of PHONE_GAPS) {
      assert.ok(
        !(TRACKED_FIELDS as readonly string[]).includes(gap),
        `${gap} must never join TRACKED_FIELDS`,
      );
    }
  });
});

describe("describeGaps", () => {
  it("says how many and what, in whichever language is asked for", () => {
    assert.equal(describeGaps(["photo"], 12, "en"), "12 children: No photo");
    assert.equal(describeGaps(["photo"], 12, "hi"), "12 बच्चे: फ़ोटो बाकी है");
  });

  it("uses the singular for one child, in both", () => {
    assert.equal(describeGaps(["phone"], 1, "en"), "1 child: No mobile");
    assert.equal(describeGaps(["phone"], 1, "hi"), "1 बच्चा: मोबाइल नंबर बाकी है");
  });

  it("counts the holes rather than listing them past two", () => {
    // Four filter names in a WhatsApp message is a wall she scrolls past to
    // reach the link, which is the same argument describeClasses makes.
    const many = describeGaps(["photo", "phone", "dob", "house"], 9, "en");
    assert.equal(many, "9 children: 4 fields missing");
  });

  it("says nothing at all when nothing was filtered on", () => {
    // An ordinary round must produce a null reason, not an empty clause that
    // would leave "Class 8 — " dangling in the message.
    assert.equal(describeGaps([], 40, "en"), null);
  });
});
