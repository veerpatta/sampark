import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dbNameForLogKey,
  describeProvenance,
  latestByField,
  type Provenance,
} from "../src/lib/student-provenance";
import { logKeyFor } from "../src/lib/student-edit";

const at = (iso: string) => new Date(iso);
const day = (date: Date) => date.toISOString().slice(0, 10);

describe("dbNameForLogKey", () => {
  it("is the inverse of logKeyFor for every column that differs", () => {
    for (const column of ["phone", "father_name", "photo_path", "bus_route"]) {
      assert.equal(dbNameForLogKey(logKeyFor(column)), column);
    }
  });
});

describe("latestByField", () => {
  it("keeps the newest changing decision per column, and ignores rejections", () => {
    const latest = latestByField([
      { fieldKey: "phone", decidedByName: "Raj", decidedAt: at("2026-08-01T00:00:00Z"), decision: "approved" },
      { fieldKey: "phone", decidedByName: "Komal", decidedAt: at("2026-09-01T00:00:00Z"), decision: "edited" },
      { fieldKey: "phone", decidedByName: "Raj", decidedAt: at("2026-09-02T00:00:00Z"), decision: "rejected" },
      { fieldKey: "photo", decidedByName: "Raj", decidedAt: at("2026-08-01T00:00:00Z"), decision: "approved" },
    ]);
    assert.equal(latest.get("phone")!.by, "Komal");
    assert.equal(latest.get("phone")!.decision, "edited");
    // The photograph's registry key is `photo`; its column is `photo_path`.
    assert.ok(latest.has("photo_path"));
    assert.ok(!latest.has("photo"));
  });
});

describe("describeProvenance", () => {
  const source = (over: Partial<Provenance>): Provenance => ({
    source: "psp",
    sourceLabel: "PSP Student Data Report",
    sourceUpdatedAt: at("2026-03-12T00:00:00Z"),
    lastChange: null,
    ...over,
  });

  it("names the import when nobody has touched the value since", () => {
    assert.equal(describeProvenance(source({}), true, day), "PSP import · 2026-03-12");
  });

  it("names the person when their decision is the later fact", () => {
    const edited = source({
      source: "office",
      sourceUpdatedAt: at("2026-09-01T00:00:00Z"),
      lastChange: { by: "Komal", at: at("2026-09-01T00:00:00Z"), decision: "edited" },
    });
    assert.equal(describeProvenance(edited, true, day), "Set by Komal · 2026-09-01");

    const approved = source({
      source: "teacher",
      sourceUpdatedAt: at("2026-08-20T00:00:00Z"),
      lastChange: { by: "Raj", at: at("2026-08-20T00:00:00Z"), decision: "approved" },
    });
    assert.equal(
      describeProvenance(approved, true, day),
      "Teacher correction, approved by Raj · 2026-08-20",
    );

    const created = source({ source: "office", sourceUpdatedAt: null, lastChange: { by: "Raj", at: at("2026-09-03T00:00:00Z"), decision: "created" } });
    assert.equal(describeProvenance(created, true, day), "Added by Raj · 2026-09-03");
  });

  it("falls back to the import when a later import overwrote the person's value", () => {
    const stale = source({
      source: "fees",
      sourceUpdatedAt: at("2026-09-02T00:00:00Z"),
      lastChange: { by: "Komal", at: at("2026-08-01T00:00:00Z"), decision: "edited" },
    });
    assert.equal(describeProvenance(stale, true, day), "Fee app import · 2026-09-02");
  });

  it("says nothing about an empty field with no history, and 'import' about a full one", () => {
    assert.equal(describeProvenance(undefined, false, day), null);
    assert.equal(describeProvenance(undefined, true, day), "Loaded by import");
  });
});
