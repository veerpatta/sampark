import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dbNameForLogKey,
  describeProvenance,
  describeSources,
  latestByField,
  type Provenance,
  type ProvenanceLine,
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

  it("calls an import a source line, so a card can fold it into one sentence", () => {
    assert.deepEqual(describeProvenance(source({}), true, day), {
      kind: "source",
      text: "PSP import · 2026-03-12",
      source: "PSP import",
    });
  });

  it("calls a person's decision a person line, so it sits against its own field", () => {
    const edited = source({
      source: "office",
      sourceUpdatedAt: at("2026-09-01T00:00:00Z"),
      lastChange: { by: "Komal", at: at("2026-09-01T00:00:00Z"), decision: "edited" },
    });
    assert.deepEqual(describeProvenance(edited, true, day), {
      kind: "person",
      text: "Set by Komal · 2026-09-01",
      source: "office",
    });

    const approved = source({
      source: "teacher",
      sourceUpdatedAt: at("2026-08-20T00:00:00Z"),
      lastChange: { by: "Raj", at: at("2026-08-20T00:00:00Z"), decision: "approved" },
    });
    assert.equal(
      describeProvenance(approved, true, day)!.text,
      "Teacher correction, approved by Raj · 2026-08-20",
    );

    const created = source({
      source: "office",
      sourceUpdatedAt: null,
      lastChange: { by: "Raj", at: at("2026-09-03T00:00:00Z"), decision: "created" },
    });
    assert.equal(describeProvenance(created, true, day)!.text, "Added by Raj · 2026-09-03");
  });

  it("falls back to the import when a later import overwrote the person's value", () => {
    const stale = source({
      source: "fees",
      sourceUpdatedAt: at("2026-09-02T00:00:00Z"),
      lastChange: { by: "Komal", at: at("2026-08-01T00:00:00Z"), decision: "edited" },
    });
    assert.deepEqual(describeProvenance(stale, true, day), {
      kind: "source",
      text: "Fee app import · 2026-09-02",
      source: "Fee app import",
    });
  });

  it("says nothing about an empty field with no history, and 'import' about a full one", () => {
    assert.equal(describeProvenance(undefined, false, day), null);
    assert.equal(describeProvenance(undefined, true, day)!.text, "Loaded by import");
  });
});

describe("describeSources", () => {
  const line = (source: string): ProvenanceLine => ({ kind: "source", text: `${source} · x`, source });

  it("names the files a card's remaining values came from, once", () => {
    assert.equal(
      describeSources([line("PSP import"), line("PSP import"), null]),
      "Everything else came from the PSP import.",
    );
    assert.equal(
      describeSources([line("PSP import"), line("Fee app import")]),
      "Everything else came from the PSP import and the Fee app import.",
    );
  });

  it("says nothing when a card holds no imported value", () => {
    assert.equal(describeSources([]), null);
    assert.equal(describeSources([null, { kind: "person", text: "Set by Raj", source: "office" }]), null);
  });
});
