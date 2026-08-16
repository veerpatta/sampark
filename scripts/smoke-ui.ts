import "../drizzle/env";
import assert from "node:assert/strict";
import { eq, inArray, like } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db, schema } from "../src/lib/db";
import { createRequest, listRequests } from "../src/lib/requests";
import { TEST_PREFIX, TEST_USER } from "../drizzle/seed/test-school";
import { mintSessionCookie } from "./test-session";

/**
 * The whole console, signed in, over HTTP.
 *
 *   npm run db:seed:test     # once
 *   npm run dev              # in another terminal
 *   npm run smoke:ui
 *
 * WHAT THIS COVERS THAT NOTHING ELSE DOES. `npm test` runs without a server, so
 * it never renders a page. `npm run smoke` runs with one but has no session, and
 * says so — which left every screen behind requireUser() untested: the boards,
 * the exports, the settings pages, and now /marks, which is the only place a
 * marks round is visible at all since marks stopped queueing for review.
 *
 * A page that throws at render is a 500, and a 500 is what this catches. That
 * is a low bar and it is deliberately a low bar — a smoke test that asserted
 * markup would break on every copy change and be deleted within a month. What
 * it asserts beyond the status code is only what would be silently wrong rather
 * than loudly broken: that a board renders the fixture it was given, that an
 * export parses as a workbook, and that a signed-out visitor still cannot see
 * any of it.
 *
 * It runs a real marks round through the teacher's own endpoint, so the
 * auto-apply path is exercised end to end: submit -> student_records -> the
 * board -> the workbook, with nobody approving anything.
 *
 * Everything it creates is torn down at the end. The fixture school is NOT torn
 * down — it is meant to stay.
 */

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const PERIOD = "2026-27/SMOKE";
/** The period the seeded fixture rounds live under — see seed-test-school.ts. */
const FIXTURE_PERIOD = "2026-27/FA1";

const results: { name: string; ok: boolean; detail?: string }[] = [];
const requestIds: string[] = [];
const batchIds: string[] = [];

/**
 * What a person would actually see, from what the server actually sent.
 *
 * Asserting against raw HTML does not work here and the two ways it fails are
 * both quiet. React streams a copy of the tree as a JSON flight payload inside
 * <script> tags, so a string can be "present" in the response while appearing
 * nowhere on screen. And it splits interpolated text across nodes, so `{a} / {b}`
 * ships as "10<!-- --> / <!-- -->24" and a search for "10 / 24" finds nothing
 * while the screen reads exactly that.
 *
 * So: drop the scripts, drop the comments, drop the tags, collapse the space.
 * What is left is the sentence the office reads.
 */
/** The five entities an href can carry once React has escaped it into HTML. */
function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'");
}

function visibleText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&rsquo;|&#8217;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function step(name: string, run: () => Promise<string | void>) {
  try {
    const detail = await run();
    results.push({ name, ok: true, detail: detail ?? undefined });
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, ok: false, detail });
    console.log(`  FAIL ${name}\n       ${detail.split("\n")[0]}`);
  }
}

async function main() {
  console.log(`Sampark UI smoke → ${BASE}\n`);

  const reachable = await fetch(`${BASE}/login`).catch(() => null);
  if (!reachable) {
    console.error(
      `\nABORTED: nothing is answering on ${BASE}. Start it with: npm run dev\n`,
    );
    process.exit(1);
  }

  const [owner] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, TEST_USER.id));
  if (!owner) {
    console.error(
      `\nABORTED: the fixture school is not seeded. Run: npm run db:seed:test\n`,
    );
    process.exit(1);
  }

  const cookie = await mintSessionCookie();
  const signedIn = (path: string) =>
    fetch(`${BASE}${path}`, { headers: { cookie }, redirect: "manual" });

  /* ------------------------------------------------------------------ */
  console.log("Signed out, everything is shut");

  for (const path of ["/", "/requests", "/review", "/marks", "/students", "/settings"]) {
    await step(`${path} sends a stranger to the login screen`, async () => {
      const response = await fetch(`${BASE}${path}`, { redirect: "manual" });
      assert.equal(response.status, 307, `got ${response.status}`);
      assert.match(response.headers.get("location") ?? "", /\/login/);
      return "307 → /login";
    });
  }

  /* ------------------------------------------------------------------ */
  console.log("\nSigned in, every screen renders");

  const screens: [string, string][] = [
    ["/", "the dashboard"],
    ["/requests", "the requests board"],
    ["/requests/new", "the request builder"],
    ["/requests/bulk", "the bulk send screen"],
    ["/review", "the review queue"],
    ["/marks", "the marks board"],
    ["/students", "the students board"],
    ["/students/import", "the import wizard"],
    ["/settings", "settings"],
    ["/settings/fields", "the field registry"],
    ["/settings/teachers", "the teacher list"],
    ["/settings/subjects", "subject assignments"],
    ["/settings/users", "the user list"],
    ["/settings/audit", "the audit log"],
  ];

  for (const [path, what] of screens) {
    await step(`${what} renders`, async () => {
      const response = await signedIn(path);
      assert.equal(response.status, 200, `${path} answered ${response.status}`);
      const body = await response.text();
      assert.ok(body.includes("<html"), `${path} returned no document`);
      return `200, ${(body.length / 1024).toFixed(0)} kB`;
    });
  }

  await step("a student's own page renders, with the fixture on it", async () => {
    const [student] = await db
      .select()
      .from(schema.students)
      .where(like(schema.students.id, `${TEST_PREFIX}%`))
      .limit(1);
    assert.ok(student, "no fixture students");

    const response = await signedIn(`/students/${student.id}`);
    assert.equal(response.status, 200);
    const text = visibleText(await response.text());
    assert.ok(text.includes(student.name), "the page does not name the student");
    return student.name;
  });

  await step("the students board shows the fixture school", async () => {
    // A board that renders but silently lists nobody is the failure a status
    // code cannot see.
    const text = visibleText(await (await signedIn("/students")).text());
    for (const label of ["Class 7", "Class 8", "Class 9", "Class 10"]) {
      assert.ok(text.includes(label), `${label} is missing from the board`);
    }
    return "classes 7-10 present";
  });

  /* ------------------------------------------------------------------ */
  console.log("\nA marks round, through the teacher's own link");

  const round = await step_("create a request for Class 8 maths", async () => {
    const created = await createRequest({
      title: "Smoke FA maths",
      classLabel: "Class 8",
      teacherId: `${TEST_PREFIX}T-sunita`,
      fieldKeys: ["fa_maths"],
      period: PERIOD,
      dueDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
      createdBy: TEST_USER.id,
    });
    requestIds.push(created.id);
    return created;
  });

  await step("her link opens without a login", async () => {
    const response = await fetch(`${BASE}/r/${round.token}`);
    assert.equal(response.status, 200, `got ${response.status}`);
    const text = visibleText(await response.text());

    // Her heading is the REGISTER, not the office's title for the round — she
    // needs to know which class is in front of her, and "Smoke FA maths" would
    // tell her nothing. The subtitle carries the subject and the period.
    assert.ok(text.includes("Class 8"), "her screen does not say which register this is");
    assert.ok(text.includes("FA Maths"), "her screen does not say what is being asked for");
    assert.ok(text.includes(PERIOD), "the period is missing from her screen");
    return `${round.rosterSize} children, headed "Class 8"`;
  });

  const roster = await db
    .select({ studentId: schema.requestStudents.studentId })
    .from(schema.requestStudents)
    .where(eq(schema.requestStudents.requestId, round.id));

  await step("she enters marks and they are accepted", async () => {
    const response = await fetch(`${BASE}/api/r/${round.token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: "smoke-ui-marks",
        students: roster.slice(0, 10).map((row, i) => ({
          studentId: row.studentId,
          values: { fa_maths: String(15 + (i % 10)) },
        })),
      }),
    });
    assert.ok(response.ok, `submit answered ${response.status}`);
    return `10 marks sent`;
  });

  await step("they are in the record already, with nobody approving", async () => {
    const records = await db
      .select()
      .from(schema.studentRecords)
      .where(eq(schema.studentRecords.period, PERIOD));
    assert.equal(records.length, 10, `${records.length} records, expected 10`);

    const pending = await db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.requestId, round.id));
    assert.ok(
      pending.every((row) => row.reviewStatus === "applied"),
      "a mark is sitting in the queue instead of in the record",
    );
    return "10 applied, 0 pending";
  });

  await step("no mark reached the review queue", async () => {
    // SCOPED TO THIS ROUND. The fixture school deliberately keeps a phone round
    // waiting to be reviewed, so the queue as a whole is not empty and should
    // not be — asserting on the empty state would be asserting that master data
    // stopped queueing, which is the opposite of what this change did.
    const text = visibleText(
      await (await signedIn(`/review?request=${round.id}`)).text(),
    );
    assert.ok(
      text.includes("The queue is empty"),
      "a mark is sitting in the review queue",
    );
    assert.ok(
      text.includes("An empty queue does not mean no marks came in"),
      "the empty state no longer explains where the marks went",
    );
    return "empty for this round, and points at Marks";
  });

  await step("the phone round the fixtures seeded IS still queued", async () => {
    // The other half of the same fact: master data still needs a human.
    const text = visibleText(await (await signedIn("/review")).text());
    assert.ok(
      text.includes("Check parent mobile numbers"),
      "the seeded phone corrections have vanished from the queue",
    );
    return "master data still waits for approval";
  });

  await step("the marks board shows the round and who entered it", async () => {
    const text = visibleText(
      await (await signedIn(`/marks?period=${encodeURIComponent(PERIOD)}`)).text(),
    );
    assert.ok(text.includes(PERIOD), "the period is not on the board");
    assert.ok(text.includes("Sunita Sharma"), "the teacher is not named");
    assert.ok(text.includes("FA Maths"), "the subject is not named");
    // Class 8 holds 24 in the fixture school and she has entered ten of them.
    // This is the number the office came to the screen for.
    assert.ok(
      text.includes("10 / 24"),
      `the entered-vs-roster count is wrong or missing: ${text.slice(0, 400)}`,
    );
    return "Sunita Sharma · FA Maths · 10 / 24";
  });

  await step("the board names a teacher who has entered NOTHING", async () => {
    /*
     * The fixture school keeps a Science round nobody has answered. Reading the
     * board off the stored marks alone leaves that teacher out entirely, which
     * looks exactly like a round she was never asked to do — and "who has not
     * sent theirs" is the only question this screen exists to answer. It
     * shipped that way once; this is what caught it.
     */
    const text = visibleText(
      await (await signedIn(`/marks?period=${encodeURIComponent(FIXTURE_PERIOD)}`)).text(),
    );
    assert.ok(
      text.includes("Hemlata Meena"),
      "a teacher who has entered nothing is missing from the board",
    );
    assert.ok(
      text.includes("0 / 24"),
      "her round is not shown as untouched",
    );
    assert.ok(text.includes("not started"), "the header does not count them");
    return "Hemlata Meena · 0 / 24";
  });

  /* ------------------------------------------------------------------ */
  console.log("\nOne nudge per teacher, not per form");

  await step("the dashboard sends one reminder per teacher", async () => {
    /*
     * The dashboard used to put a Remind button on every outstanding FORM, so a
     * teacher owing three of them got three near-identical WhatsApp messages
     * seconds apart. The invariant, not a count: one button per phone number,
     * and fewer buttons than there are forms outstanding.
     *
     * Asserted this way on purpose — the fixture school gains and loses rounds
     * as this file grows, and a hard-coded "2" would fail on a change that is
     * not a regression. That already happened once.
     */
    const html = await (await signedIn("/")).text();
    const hrefs = [...html.matchAll(/href="(https:\/\/wa\.me\/[^"]+)"/g)].map((m) =>
      decodeHtml(m[1]!),
    );
    assert.ok(hrefs.length > 0, "the dashboard offers no reminders at all");

    const phones = hrefs.map((href) => new URL(href).pathname);
    assert.equal(
      new Set(phones).size,
      phones.length,
      "two Remind buttons point at the same number — that is the spam this fixed",
    );

    const outstanding = (
      await listRequests({ includeArchived: false })
    ).filter(
      (row) =>
        row.status === "open" &&
        !(row.rosterSize > 0 && row.studentsAnswered >= row.rosterSize),
    ).length;
    assert.ok(
      hrefs.length < outstanding,
      `${hrefs.length} buttons for ${outstanding} outstanding forms — nothing was collapsed`,
    );
    return `${hrefs.length} buttons for ${outstanding} forms`;
  });

  await step("one teacher's message carries everything she owes, once", async () => {
    const html = await (await signedIn("/")).text();
    const hrefs = [...html.matchAll(/href="(https:\/\/wa\.me\/[^"]+)"/g)].map((m) =>
      decodeHtml(m[1]!),
    );

    const sunita = hrefs
      .map((href) => new URL(href).searchParams.get("text") ?? "")
      .find((text) => text.includes("Sunita Sharma"));
    assert.ok(sunita, "no message addressed to her");

    // "N lists", whatever N is — she owes the fixture rounds plus whatever this
    // script has created by now, and pinning the number pins the fixtures.
    assert.match(
      sunita!,
      /\d+ lists are still pending/,
      "her forms were not collapsed into one message",
    );
    assert.ok(sunita!.includes("Smoke FA maths"), "the round this script made is missing");

    /*
     * EXACTLY ONE URL, and it must be absolute. She has a durable page, so it
     * carries both forms and per-form links would be the wall this collapses.
     * The absolute check is the regression guard: this component renders on the
     * server, where `window` does not exist, and a render-time
     * window.location.origin baked a relative "/t/abc" into the href that React
     * then kept through hydration — a link that means nothing in WhatsApp.
     */
    const urls = sunita!.match(/https?:\/\/\S+/g) ?? [];
    assert.equal(urls.length, 1, `${urls.length} links in one reminder: ${urls}`);
    assert.match(urls[0]!, /^https?:\/\/[^/]+\/t\//, `not an absolute /t/ link: ${urls[0]}`);
    return "1 message, 1 absolute link";
  });

  /* ------------------------------------------------------------------ */
  console.log("\nA send-to-many round is one thing");

  const roundBatchId = await step_("create a round over two classes", async () => {
    const { createBatch } = await import("../src/lib/batches");
    const created = await createBatch({
      title: "Smoke round",
      audience: { classes: ["Class 9", "Class 10"] },
      fieldKeys: ["phone"],
      dueDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
      recipientMode: "class_teacher",
      createdBy: TEST_USER.id,
    });
    for (const link of created.created) requestIds.push(link.requestId);
    batchIds.push(created.batchId);
    return created.batchId;
  });

  await step("the board shows the round as ONE row", async () => {
    /*
     * THE REGRESSION GUARD FOR THIS WHOLE FEATURE. The round's two links must
     * not appear as their own rows — that is what the board did before, and it
     * is the thing that is easy to reintroduce by touching the projection.
     *
     * ?view=rounds explicitly, because /requests now opens on the by-teacher
     * board. Without this the assertion would pass or fail on a screen that has
     * no rows at all, which is the worst kind of green.
     */
    const html = await (await signedIn("/requests?view=rounds")).text();
    const text = visibleText(html);

    assert.ok(text.includes("Smoke round"), "the round is not on the board");
    assert.ok(text.includes("2 groups"), "it is not shown as a round");
    assert.ok(
      html.includes(`/requests/batch/${roundBatchId}`),
      "the row does not open the round",
    );

    for (const childId of requestIds.slice(-2)) {
      assert.ok(
        !html.includes(`/requests/${childId}"`),
        `a child link is still its own row: ${childId}`,
      );
    }
    return "one row, two groups";
  });

  await step("the board OPENS on how far each teacher has got", async () => {
    /*
     * The default view, and the reason the guard above had to name its own.
     * The office's question after a round is "who is behind", and until this
     * existed the board could only answer "which links exist".
     */
    const html = await (await signedIn("/requests")).text();
    const text = visibleText(html);

    assert.ok(
      text.includes("still to answer for"),
      "the by-teacher board is not what /requests opens on",
    );
    assert.ok(
      html.includes('href="/requests?view=rounds"'),
      "there is no way through to the round board",
    );
    // Marks and student data are counted separately, never averaged into one
    // figure that describes neither.
    assert.ok(
      text.includes("marks") || text.includes("details"),
      "the two kinds of work are not split",
    );
    return "teachers, with marks and details apart";
  });

  await step("the round page opens, and lists both groups", async () => {
    const text = visibleText(
      await (await signedIn(`/requests/batch/${roundBatchId}`)).text(),
    );
    assert.ok(text.includes("Class 9") && text.includes("Class 10"));
    assert.ok(text.includes("Still waiting"), "the round cannot be chased");
    return "both groups, with a nudge card";
  });

  await step("a link inside the round links back to it", async () => {
    const html = await (
      await signedIn(`/requests/${requestIds[requestIds.length - 1]}`)
    ).text();
    assert.ok(
      html.includes(`/requests/batch/${roundBatchId}`),
      "a child request has no way back to its round",
    );
    return "back to the round";
  });

  await step("the round workbook downloads and parses", async () => {
    const response = await signedIn(`/api/export/batch/${roundBatchId}.xlsx`);
    assert.equal(response.status, 200, `got ${response.status}`);

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const names = book.worksheets.map((sheet) => sheet.name);

    assert.equal(names[0], "Summary", `first sheet is ${names[0]}`);
    assert.equal(names.length, 3, `${names.length} sheets, expected 1 + 2 links`);
    assert.equal(new Set(names).size, names.length, "two sheets share a name");

    /*
     * Every Sheet value names a real worksheet. One assertion covering three
     * failures at once: a drifted header key, a truncation collision, and a
     * label array that got out of step with the sheets it describes.
     */
    const summary = book.getWorksheet("Summary")!;
    const sheetColumn = summary
      .getRows(2, summary.rowCount - 1)!
      .map((row) => String((row.values as unknown[])[1]));
    for (const value of sheetColumn) {
      assert.ok(names.includes(value), `Summary names a sheet that is not here: ${value}`);
    }
    return `${names.join(", ")}`;
  });

  await step("a marks round exports one column per subject", async () => {
    /*
     * Not the (sent)/(teacher) pair the other rounds get. A mark is collected
     * rather than corrected, so a "(sent)" column would be blank for every
     * child in the school — and dropping it is what turns this sheet into the
     * marks layout without a second code path.
     */
    const { createBatch } = await import("../src/lib/batches");
    const marks = await createBatch({
      title: "Smoke marks round",
      audience: { classes: ["Class 9", "Class 10"] },
      fieldKeys: ["fa_maths"],
      period: PERIOD,
      dueDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
      recipientMode: "class_teacher",
      createdBy: TEST_USER.id,
    });
    for (const link of marks.created) requestIds.push(link.requestId);
    batchIds.push(marks.batchId);

    const response = await signedIn(`/api/export/batch/${marks.batchId}.xlsx`);
    assert.equal(response.status, 200, `got ${response.status}`);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());

    const sheet = book.worksheets.find((ws) => ws.name !== "Summary")!;
    const headers = (sheet.getRow(1).values as unknown[])
      .map(String)
      .filter((header) => header !== "undefined");

    assert.ok(headers.includes("FA Maths"), `no subject column: ${headers.join(" | ")}`);
    assert.ok(
      !headers.some((header) => header.includes("(sent)")),
      `a marks field kept its sent column: ${headers.join(" | ")}`,
    );
    return headers.join(" | ");
  });

  await step("an unknown round is a readable 404", async () => {
    const response = await signedIn(
      "/api/export/batch/00000000-0000-0000-0000-000000000000.xlsx",
    );
    assert.equal(response.status, 404, `got ${response.status}`);
    return "404";
  });

  await step("the round export refuses a signed-out visitor", async () => {
    const response = await fetch(`${BASE}/api/export/batch/${roundBatchId}.xlsx`);
    assert.equal(response.status, 401);
    return "401";
  });

  /* ------------------------------------------------------------------ */
  console.log("\nThe files the office takes away");

  await step("the marks workbook downloads and parses", async () => {
    const response = await signedIn(
      `/api/export/marks.xlsx?period=${encodeURIComponent(PERIOD)}`,
    );
    assert.equal(response.status, 200, `got ${response.status}`);

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());

    const names = book.worksheets.map((sheet) => sheet.name);
    assert.equal(names[0], "Summary", `first sheet is ${names[0]}`);
    assert.ok(names.includes("Sunita Sharma"), `no sheet for the teacher: ${names}`);
    assert.equal(new Set(names).size, names.length, "two sheets share a name");

    const sheet = book.getWorksheet("Sunita Sharma")!;
    // Header plus one row per child she entered for.
    assert.equal(sheet.rowCount, 11, `${sheet.rowCount} rows, expected 11`);
    assert.ok(
      sheet.getRow(1).values.toString().includes("FA Maths"),
      "the subject column is missing",
    );
    return `${names.length} sheets: ${names.join(", ")}`;
  });

  await step("the by-class workbook regroups the same round", async () => {
    const response = await signedIn(
      `/api/export/marks.xlsx?period=${encodeURIComponent(PERIOD)}&by=class`,
    );
    assert.equal(response.status, 200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const names = book.worksheets.map((sheet) => sheet.name);
    assert.ok(names.includes("Class 8"), `no class sheet: ${names}`);
    return names.join(", ");
  });

  await step("the summary sheet carries the teacher who sent nothing", async () => {
    /*
     * Against the FIXTURE period, not the smoke round — the smoke round has one
     * teacher and she has entered, so it cannot see this. A teacher who has
     * sent nothing has no marks to group into a sheet of her own, and the whole
     * question the office has after a round is who those teachers are. Her line
     * also carries no entry date, which is the null the summary column has to
     * survive.
     */
    const response = await signedIn(
      `/api/export/marks.xlsx?period=${encodeURIComponent(FIXTURE_PERIOD)}`,
    );
    assert.equal(response.status, 200, `got ${response.status}`);

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const summary = book.getWorksheet("Summary")!;

    const lines = summary
      .getRows(2, summary.rowCount - 1)!
      .map((row) => (row.values as unknown[]).slice(1).map(String));

    // Teacher | Subject | Class | Entered | On roster | Missing | Last entered
    const hemlata = lines.find((line) => line[0] === "Hemlata Meena");
    assert.ok(hemlata, `she is not on the summary sheet: ${JSON.stringify(lines)}`);
    assert.equal(hemlata![3], "0", `her entered count is wrong: ${hemlata}`);
    assert.equal(hemlata![5], "24", `her whole class should be outstanding: ${hemlata}`);

    // And no sheet of her own, because she has no marks to put on one.
    assert.ok(
      !book.worksheets.some((sheet) => sheet.name === "Hemlata Meena"),
      "an empty sheet was written for a teacher with no marks",
    );
    return "Hemlata Meena · 0 entered · 24 missing";
  });

  await step("the students workbook downloads and parses", async () => {
    const response = await signedIn("/api/export/students.xlsx?photos=0");
    assert.equal(response.status, 200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    return `${book.worksheets.length} class sheets`;
  });

  await step("an unknown period is a readable 404, not a broken file", async () => {
    const response = await signedIn("/api/export/marks.xlsx?period=nope");
    assert.equal(response.status, 404, `got ${response.status}`);
    return "404";
  });

  await step("the marks export refuses a signed-out visitor", async () => {
    const response = await fetch(
      `${BASE}/api/export/marks.xlsx?period=${encodeURIComponent(PERIOD)}`,
    );
    assert.equal(response.status, 401);
    return "401";
  });

  /* ------------------------------------------------------------------ */
  console.log("\nCleaning up …");
  await teardown();

  const passed = results.filter((row) => row.ok).length;
  console.log(`\n${passed}/${results.length} checks passed.`);
  process.exit(passed === results.length ? 0 : 1);
}

/** `step`, for the ones whose value the rest of the run needs. */
async function step_<T>(name: string, run: () => Promise<T>): Promise<T> {
  const value = await run().catch((error) => {
    console.log(`  FAIL ${name}\n       ${String(error).split("\n")[0]}`);
    process.exit(1);
  });
  results.push({ name, ok: true });
  console.log(`  ok   ${name}`);
  return value;
}

/**
 * The round goes; the school stays.
 *
 * Owner connection, because app_rw is denied DELETE on submissions — which is
 * the append-only guarantee working, not a problem to route around in the app.
 */
async function teardown() {
  const { neon } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-http");
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!;
  const owner = drizzle(neon(url), { schema });

  if (requestIds.length > 0) {
    await owner
      .delete(schema.studentRecords)
      .where(inArray(schema.studentRecords.requestId, requestIds));
    await owner
      .delete(schema.submissions)
      .where(inArray(schema.submissions.requestId, requestIds));
    await owner
      .delete(schema.requestStudents)
      .where(inArray(schema.requestStudents.requestId, requestIds));
    await owner.delete(schema.requests).where(inArray(schema.requests.id, requestIds));
  }
  // Belt and braces: anything left filed under the smoke period.
  await owner
    .delete(schema.studentRecords)
    .where(eq(schema.studentRecords.period, PERIOD));

  /*
   * The rounds, AFTER their links. requests.batch_id is ON DELETE SET NULL, so
   * the other order would quietly orphan them instead of failing loudly.
   */
  if (batchIds.length > 0) {
    await owner
      .delete(schema.requestBatches)
      .where(inArray(schema.requestBatches.id, batchIds));
  }

  console.log("  removed the smoke round; the fixture school stays");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
