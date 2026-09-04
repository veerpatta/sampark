import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LANGUAGES,
  NEVER_ON_TEACHER_PAGE_KEYS,
  SUMMARY_MAX,
  TEMPLATE_BUTTON_BASE,
  TEMPLATE_KINDS,
  TEMPLATE_TEXT,
  TEST_SUFFIX,
  allTemplates,
  buildLinkPayload,
  buildReminderPayloads,
  buildRequestPayloads,
  buildTestPayload,
  expectedParamCount,
  isLanguage,
  messageCount,
  renderPreview,
  sanitiseParam,
  suffixFor,
  templateName,
  type ReminderPayloadItem,
  type RequestPayloadLink,
} from "../src/lib/whatsapp-templates";
import { isListableOnTeacherPage } from "../src/lib/auth/token";
import { MAX_NAMED_INLINE, type PendingStudent } from "../src/lib/pending";

/**
 * The template is fixed at approval and the app may only fill its holes, so
 * the two ways this goes wrong are both silent until AiSensy refuses the
 * message: the wrong NUMBER of values, or a value Meta will not carry (a
 * newline, a tab, a run of spaces). Both are pinned here.
 */

const TOKEN = "AbCdEfGhIjKlMnOp";
const PAGE = "PaGeToKeNpAgEtOk";

const link = (over: Partial<RequestPayloadLink> = {}): RequestPayloadLink => ({
  requestId: "R1",
  token: TOKEN,
  fieldKeys: ["phone"],
  audience: { kind: "class", label: "Class 8" },
  ...over,
});

function child(n: number): PendingStudent {
  return { studentId: `S${n}`, rollNo: n, name: `Child ${n}`, classLabel: "Class 8" };
}

const item = (over: Partial<ReminderPayloadItem> = {}): ReminderPayloadItem => ({
  requestId: "R1",
  token: TOKEN,
  fieldKeys: ["fa_maths"],
  audience: { kind: "class", label: "Class 8" },
  title: "FA1 marks",
  dueDate: "2026-08-20",
  answered: 38,
  rosterSize: 40,
  pending: [child(3), child(7)],
  ...over,
});

/** What Meta refuses inside a value. */
function assertCleanParam(value: string) {
  assert.doesNotMatch(value, /[\n\r\t]/, "a newline or tab in a param");
  assert.doesNotMatch(value, / {2,}/, "a run of spaces in a param");
  assert.doesNotMatch(value, /[०-९]/, "a Devanagari digit");
  assert.notEqual(value.trim(), "", "an empty param");
}

describe("the template texts", () => {
  it("number their holes sequentially from 1, in order of appearance", () => {
    for (const spec of allTemplates()) {
      const seen = (spec.body.match(/\{\{(\d+)\}\}/g) ?? []).map((hole) =>
        Number(hole.replace(/\D/g, "")),
      );
      const distinct = [...new Set(seen)];
      assert.deepEqual(
        distinct,
        distinct.map((_, index) => index + 1),
        `${spec.name}: ${seen.join(",")}`,
      );
      const button = Number(spec.button.url.replace(/\D/g, ""));
      assert.equal(button, distinct.length + 1, `${spec.name}: button hole`);
    }
  });

  it("never start or end the body with a hole on its own", () => {
    for (const spec of allTemplates()) {
      const lines = spec.body.split("\n").filter((line) => line.trim() !== "");
      assert.doesNotMatch(lines[0]!, /^\{\{\d+\}\}$/, spec.name);
      assert.doesNotMatch(lines.at(-1)!, /^\{\{\d+\}\}$/, spec.name);
    }
  });

  it("carry one sample per body hole, plus one for the button", () => {
    for (const spec of allTemplates()) {
      const holes = expectedParamCount(spec.name.split("_")[1] as never, spec.language);
      assert.equal(spec.samples.length, holes + 1, spec.name);
    }
  });

  it("point every button at the production dispatcher", () => {
    for (const spec of allTemplates()) {
      assert.ok(spec.button.url.startsWith(TEMPLATE_BUTTON_BASE), spec.name);
    }
    assert.match(TEMPLATE_BUTTON_BASE, /^https:\/\/[^/]+\/w\/$/);
  });

  it("exist in both languages for every kind, and are named predictably", () => {
    for (const kind of TEMPLATE_KINDS) {
      for (const language of LANGUAGES) {
        assert.equal(TEMPLATE_TEXT[kind][language].name, `sampark_${kind}_${language}`);
        assert.equal(templateName(kind, language), TEMPLATE_TEXT[kind][language].name);
      }
    }
  });

  it("quote the on-screen button words in Latin script in the Hindi request", () => {
    // HOW_TO in lib/whatsapp.ts: the words she is told to press must be the
    // words on the screen, and the screen says Correct and Change.
    assert.match(TEMPLATE_TEXT.request.hi.body, /"Correct"/);
    assert.match(TEMPLATE_TEXT.request.hi.body, /"Change"/);
  });

  it("use no Devanagari digits anywhere in teacher-facing text", () => {
    for (const spec of allTemplates()) {
      assert.doesNotMatch(spec.body, /[०-९]/, spec.name);
      assert.doesNotMatch(spec.button.text, /[०-९]/, spec.name);
    }
  });
});

describe("sanitiseParam", () => {
  it("flattens newlines, tabs and runs of spaces to one space", () => {
    assert.equal(sanitiseParam("a\n b\t\tc    d"), "a b c d");
  });

  it("truncates with an ellipsis at the cap", () => {
    const out = sanitiseParam("x".repeat(50), 10);
    assert.equal(out.length, 10);
    assert.ok(out.endsWith("…"));
  });
});

describe("suffixFor", () => {
  it("opens her page when she has one and every link may appear on it", () => {
    const plan = suffixFor([link(), link({ requestId: "R2", token: "BbCdEfGhIjKlMnOp" })], PAGE);
    assert.equal(plan.mode, "page");
    assert.equal(plan.mode === "page" && plan.suffix, PAGE);
    assert.deepEqual(plan.mode === "page" && plan.requestIds, ["R1", "R2"]);
  });

  it("opens the one link directly when she has no page", () => {
    const plan = suffixFor([link()], null);
    assert.equal(plan.mode, "single");
    assert.equal(plan.mode === "single" && plan.suffix, TOKEN);
  });

  it("refuses to put a photo round on her page — one message per link instead", () => {
    // NEVER_ON_TEACHER_PAGE: a page carrying a photo or Aadhaar round is the
    // one thing the durable link must never do, however many links it saves.
    const plan = suffixFor(
      [link({ fieldKeys: ["photo"] }), link({ requestId: "R2", token: "BbCdEfGhIjKlMnOp", fieldKeys: ["photo"] })],
      PAGE,
    );
    assert.equal(plan.mode, "split");
    assert.equal(plan.mode === "split" && plan.messages.length, 2);
    assert.equal(messageCount([link({ fieldKeys: ["aadhaar"] }), link({ requestId: "R2" })], PAGE), 2);
  });

  it("sends a lone sensitive link directly even when she has a page", () => {
    const plan = suffixFor([link({ fieldKeys: ["dob"] })], PAGE);
    assert.equal(plan.mode, "single");
    assert.equal(plan.mode === "single" && plan.suffix, TOKEN);
  });

  it("keeps the same list of never-on-page keys as lib/auth/token.ts", () => {
    // Duplicated because token.ts imports the database and this module may
    // reach the browser. This is what stops the copy drifting.
    for (const key of ["aadhaar", "jan_aadhaar", "dob", "photo", "phone", "fa_maths"]) {
      assert.equal(
        !NEVER_ON_TEACHER_PAGE_KEYS.has(key),
        isListableOnTeacherPage([key]),
        key,
      );
    }
  });
});

describe("buildRequestPayloads", () => {
  it("fills exactly the holes the request template has, in both languages", () => {
    for (const language of LANGUAGES) {
      const [payload] = buildRequestPayloads({
        teacherName: "Sunita Sharma",
        language,
        title: "FA1 marks",
        dueDate: "2026-08-20",
        links: [link()],
        linkToken: null,
      });
      assert.equal(payload!.params.length, expectedParamCount("request", language));
      // The token is the button's parameter, never a body value — AiSensy
      // refuses the call otherwise.
      assert.ok(!payload!.params.includes(TOKEN));
      assert.equal(payload!.suffix, TOKEN);
      payload!.params.forEach(assertCleanParam);
    }
  });

  it("names the group the way the manual message does", () => {
    const [en] = buildRequestPayloads({
      teacherName: "Sunita",
      language: "en",
      title: "Phone numbers",
      dueDate: "2026-08-20",
      links: [link({ audience: { kind: "house", label: "Rana Pratap" } })],
      linkToken: null,
    });
    assert.equal(en!.params[2], "Rana Pratap House");
    const [hi] = buildRequestPayloads({
      teacherName: "Sunita",
      language: "hi",
      title: "Phone numbers",
      dueDate: "2026-08-20",
      links: [link()],
      linkToken: null,
    });
    assert.equal(hi!.params[2], "कक्षा Class 8");
    assert.equal(hi!.params[3], "20 Aug");
  });

  it("collapses several links into one message that opens her page", () => {
    const payloads = buildRequestPayloads({
      teacherName: "Prakash",
      language: "en",
      title: "FA1 marks",
      dueDate: "2026-08-20",
      links: [
        link({ requestId: "R1", audience: { kind: "class", label: "Class 8" } }),
        link({ requestId: "R2", token: "BbCdEfGhIjKlMnOp", audience: { kind: "class", label: "Class 9" } }),
        link({
          requestId: "R3",
          token: "CbCdEfGhIjKlMnOp",
          fieldKeys: ["fa_maths"],
          audience: { kind: "subject", label: "Maths — Prakash", fieldKeys: ["fa_maths"], classLabels: ["Class 10", "Class 11 Science"] },
        }),
      ],
      linkToken: PAGE,
    });
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0]!.params[2], "3 lists: 1) Class 8 · 2) Class 9 · 3) Maths");
    assert.equal(payloads[0]!.suffix, PAGE);
    assert.deepEqual(payloads[0]!.requestIds, ["R1", "R2", "R3"]);
  });

  it("splits a photo round into one message per link, each naming only its own group", () => {
    const payloads = buildRequestPayloads({
      teacherName: "Sunita",
      language: "en",
      title: "Student photos",
      dueDate: "2026-08-20",
      links: [
        link({ requestId: "R1", fieldKeys: ["photo"] }),
        link({ requestId: "R2", token: "BbCdEfGhIjKlMnOp", fieldKeys: ["photo"], audience: { kind: "class", label: "Class 9" } }),
      ],
      linkToken: PAGE,
    });
    assert.equal(payloads.length, 2);
    assert.equal(payloads[0]!.params[2], "Class 8");
    assert.equal(payloads[0]!.suffix, TOKEN);
    assert.deepEqual(payloads[0]!.requestIds, ["R1"]);
    assert.equal(payloads[1]!.params[2], "Class 9");
    assert.deepEqual(payloads[1]!.requestIds, ["R2"]);
  });
});

describe("buildReminderPayloads", () => {
  it("fills exactly the reminder template's holes, in both languages", () => {
    for (const language of LANGUAGES) {
      const [payload] = buildReminderPayloads({
        teacherName: "Sunita Sharma",
        language,
        items: [item()],
        linkToken: null,
      });
      assert.equal(payload!.params.length, expectedParamCount("reminder", language));
      payload!.params.forEach(assertCleanParam);
    }
  });

  it("carries progress, the children still left, and the due date on one line", () => {
    const [en] = buildReminderPayloads({
      teacherName: "Sunita",
      language: "en",
      items: [item()],
      linkToken: null,
    });
    assert.equal(
      en!.params[1],
      "FA1 marks · Class 8 — 38 of 40 done, still to fill: 3. Child 3, 7. Child 7 — due 20 Aug",
    );
    const [hi] = buildReminderPayloads({
      teacherName: "Sunita",
      language: "hi",
      items: [item()],
      linkToken: null,
    });
    assert.equal(
      hi!.params[1],
      "FA1 marks · कक्षा Class 8 — 40 में से 38 हो गए, भरना बाकी: 3. Child 3, 7. Child 7 — अंतिम तिथि 20 Aug",
    );
  });

  it("says not started, and names nobody, for an untouched list", () => {
    const [en] = buildReminderPayloads({
      teacherName: "Sunita",
      language: "en",
      items: [item({ answered: 0, pending: null })],
      linkToken: null,
    });
    assert.equal(en!.params[1], "FA1 marks · Class 8 — not started — due 20 Aug");
  });

  it("names nobody when more than the inline cap are left — the count is the fact", () => {
    // The inline shape's rule, verbatim: whole list or nothing. The progress
    // text already says how many.
    const left = MAX_NAMED_INLINE + 1;
    const [en] = buildReminderPayloads({
      teacherName: "Sunita",
      language: "en",
      items: [
        item({
          answered: 40 - left,
          pending: Array.from({ length: left }, (_, i) => child(i + 1)),
        }),
      ],
      linkToken: null,
    });
    assert.doesNotMatch(en!.params[1]!, /still to fill/);
    assert.match(en!.params[1]!, /31 of 40 done/);
  });

  it("numbers several lists inside one value and opens her page", () => {
    const payloads = buildReminderPayloads({
      teacherName: "Prakash",
      language: "en",
      items: [
        item({ requestId: "R1" }),
        item({
          requestId: "R2",
          token: "BbCdEfGhIjKlMnOp",
          audience: { kind: "class", label: "Class 9" },
          answered: 0,
          pending: null,
          dueDate: "2026-08-25",
        }),
      ],
      linkToken: PAGE,
    });
    assert.equal(payloads.length, 1);
    assert.equal(
      payloads[0]!.params[1],
      "2 lists: 1) FA1 marks · Class 8 — 38 of 40 done, still to fill: 3. Child 3, 7. Child 7 — due 20 Aug; 2) FA1 marks · Class 9 — not started — due 25 Aug",
    );
    assert.equal(payloads[0]!.suffix, PAGE);
  });

  it("adds the class after a name only when the list spans registers", () => {
    const [en] = buildReminderPayloads({
      teacherName: "Hemlata",
      language: "en",
      items: [
        item({
          audience: { kind: "subject", label: "Chemistry", fieldKeys: ["fa_chemistry"], classLabels: ["Class 11 Science", "Class 12 Science"] },
          pending: [{ ...child(3), classLabel: "Class 12 Science" }],
          answered: 39,
        }),
      ],
      linkToken: null,
    });
    assert.match(en!.params[1]!, /3\. Child 3 \(Class 12 Science\)/);
  });

  it("keeps the summary under the cap however long the round", () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      item({
        requestId: `R${i}`,
        token: `T${String(i).padStart(15, "0")}`,
        audience: { kind: "class", label: `Class ${i + 1}` },
        pending: Array.from({ length: 8 }, (_, j) => child(j + 1)),
        answered: 32,
      }),
    );
    const [en] = buildReminderPayloads({ teacherName: "X", language: "en", items, linkToken: PAGE });
    assert.ok(en!.params[1]!.length <= SUMMARY_MAX);
    assertCleanParam(en!.params[1]!);
  });
});

describe("buildLinkPayload and buildTestPayload", () => {
  it("hand over her page with exactly two values", () => {
    const payload = buildLinkPayload({ teacherName: "Sunita", language: "hi", linkToken: PAGE });
    assert.equal(payload.params.length, expectedParamCount("link", "hi"));
    assert.deepEqual(payload.params, ["Sunita"]);
    assert.equal(payload.suffix, PAGE);
    assert.deepEqual(payload.requestIds, []);
  });

  it("build a test send that carries the samples and the test suffix", () => {
    for (const language of LANGUAGES) {
      const payload = buildTestPayload(language);
      assert.equal(payload.params.length, expectedParamCount("request", language));
      assert.equal(payload.suffix, TEST_SUFFIX);
      assert.ok(!payload.params.includes(TEST_SUFFIX));
      assert.deepEqual(payload.requestIds, []);
    }
  });

  it("render a preview with every hole filled", () => {
    const preview = renderPreview(buildTestPayload("en"));
    assert.doesNotMatch(preview, /\{\{\d+\}\}/);
    assert.match(preview, /Sunita Sharma/);
    assert.match(preview, new RegExp(`${TEMPLATE_BUTTON_BASE}${TEST_SUFFIX}`));
  });
});

describe("isLanguage", () => {
  it("accepts only the two languages there are templates for", () => {
    assert.ok(isLanguage("hi"));
    assert.ok(isLanguage("en"));
    assert.ok(!isLanguage("hinglish"));
    assert.ok(!isLanguage(undefined));
  });
});
