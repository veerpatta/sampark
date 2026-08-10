import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateField } from "../src/lib/fields";
import { photoPathname } from "../src/lib/photos";
import type { FieldDef } from "../drizzle/schema";

/**
 * The registry's validators, at the boundary that matters: the same code runs
 * on the teacher's phone for instant feedback and on the server because the
 * phone is never trusted. A rule that holds in one and not the other is the
 * shape of bug this file exists to catch.
 */

type Def = Parameters<typeof validateField>[0];

const def = (overrides: Partial<FieldDef> & { key: string }): Def =>
  ({
    labelEn: "Test field",
    inputType: "text",
    exactLen: null,
    pattern: null,
    maxValue: null,
    options: null,
    ...overrides,
  }) as Def;

const PHOTO = def({ key: "photo", inputType: "photo", labelEn: "Student photo" });

describe("validateField — photo", () => {
  it("accepts a pathname this app minted", () => {
    const value = photoPathname("S1001");
    const result = validateField(PHOTO, value);
    assert.deepEqual(result, { ok: true, value });
  });

  it("accepts blank as 'no change', so a photo can never be erased", () => {
    // The same rule every other field follows. A teacher has no way to say
    // "this child should have no photograph", and a cleared field must not be
    // read as one.
    assert.deepEqual(validateField(PHOTO, ""), { ok: true, value: null });
    assert.deepEqual(validateField(PHOTO, null), { ok: true, value: null });
    assert.deepEqual(validateField(PHOTO, "   "), { ok: true, value: null });
  });

  it("refuses anything that is not a pathname it recognises", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:image/jpeg;base64,AAAA",
      "../../etc/passwd",
      "https://x.public.blob.vercel-storage.com/students/S1001/a.jpg",
      "students/S1001/hello.jpg",
    ]) {
      const result = validateField(PHOTO, value);
      assert.equal(result.ok, false, `accepted ${value}`);
      if (!result.ok) {
        // Both halves, because the teacher surface shows English over Hindi.
        assert.ok(result.error.length > 0);
        assert.ok(result.errorHi.length > 0);
      }
    }
  });
});

describe("validateField — the rules a photo field inherits", () => {
  it("still trims and length-checks a plain text field", () => {
    const four = def({ key: "code", exactLen: 4 });
    assert.deepEqual(validateField(four, " abcd "), { ok: true, value: "abcd" });
    assert.equal(validateField(four, "abc").ok, false);
  });

  it("still refuses a value outside a select's options", () => {
    const house = def({
      key: "house",
      inputType: "select",
      options: ["Rana Pratap", "Rana Sanga"],
    });
    assert.equal(validateField(house, "Rana Pratap").ok, true);
    assert.equal(validateField(house, "Nonesuch").ok, false);
  });
});
