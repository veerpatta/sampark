import "../drizzle/env";
import assert from "node:assert/strict";
import { eq, and, sql } from "drizzle-orm";
import { del, head } from "@vercel/blob";
import { db, schema } from "../src/lib/db";
import { decideSubmissions } from "../src/lib/submissions";
import { listRequests } from "../src/lib/requests";
import { listStudents } from "../src/lib/students";
import { photoPathname, thumbPathname } from "../src/lib/photos";
import { createScenario, cleanup } from "../tests/fixtures";

/**
 * The photo round, end to end, against a running server and the real stores.
 *
 *   npm run dev            # in another terminal
 *   npm run smoke
 *
 * WHY THIS IS NOT IN `npm test`. Everything under tests/ runs with no server
 * and no blob store, so the route handlers — where the rate limiter, the roster
 * check and the JPEG sniff actually live — are the one layer the unit tests
 * cannot reach. This drives them over HTTP exactly as a teacher's phone does,
 * writes real bytes to Vercel Blob, and then walks the answer through review
 * into the master record.
 *
 * It is also the only thing that proves BLOB_READ_WRITE_TOKEN is wired to a
 * PRIVATE store. A public one would work identically from inside the app and
 * differ only in that every photograph of every child would be readable by
 * anyone holding the URL — so this asserts an anonymous fetch is refused.
 *
 * Everything it creates is prefixed ZZTESTSMOKE and torn down at the end,
 * including the blobs. Safe to run against the dev branch; it invents every
 * value it writes (standing rule 12).
 */

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";

/** A real, decodable 1x1 JPEG. Base64 so no fixture file has to be shipped. */
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
    "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

/** A PNG header. Enough to prove the sniffer looks at bytes, not at file.type. */
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

const results: { name: string; ok: boolean; detail?: string }[] = [];
const blobsToDelete: string[] = [];

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

/** Multipart, the way PhotoField sends it. */
function photoBody(studentId: string, file: Buffer, thumb?: Buffer): FormData {
  const body = new FormData();
  body.append("studentId", studentId);
  body.append("file", new Blob([new Uint8Array(file)], { type: "image/jpeg" }), "photo.jpg");
  if (thumb) {
    body.append("thumb", new Blob([new Uint8Array(thumb)], { type: "image/jpeg" }), "thumb.jpg");
  }
  return body;
}

async function main() {
  console.log(`Sampark smoke test → ${BASE}\n`);

  // Fail early and clearly rather than reporting twelve confusing 404s.
  const reachable = await fetch(`${BASE}/login`).catch(() => null);
  if (!reachable) {
    throw new Error(`Nothing is answering on ${BASE}. Start it with: npm run dev`);
  }

  console.log("Creating a photo round …");
  const scenario = await createScenario({ fieldKeys: ["phone", "photo"] });
  const [first, second] = scenario.studentIds as [string, string];
  const token = scenario.token;
  console.log(`  request ${scenario.requestId}`);
  console.log(`  token   ${token}`);
  console.log(`  students ${first}, ${second}\n`);

  let uploaded = "";

  console.log("The teacher's link");

  await step("the form page renders", async () => {
    const response = await fetch(`${BASE}/r/${token}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes("Student photo"), "the photo field is not on the page");
    assert.ok(
      !html.includes("मेरी कक्षा में नहीं है"),
      "the not-in-class button is still rendered",
    );
    assert.ok(html.includes("Take photo"), "the camera button is missing");
    return "English labels present, no not-in-class button";
  });

  await step("the security headers are on /r/*", async () => {
    const response = await fetch(`${BASE}/r/${token}`);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    return "noindex + no-referrer";
  });

  console.log("\nUploading a photograph");

  await step("a JPEG for a child on the roster is stored", async () => {
    const response = await fetch(`${BASE}/api/r/${token}/photo`, {
      method: "POST",
      body: photoBody(first, JPEG, JPEG),
    });
    assert.equal(response.status, 201, `expected 201, got ${response.status}`);
    const body = (await response.json()) as { pathname?: string };
    assert.ok(body.pathname, "no pathname came back");
    uploaded = body.pathname!;
    blobsToDelete.push(uploaded, thumbPathname(uploaded));
    assert.ok(uploaded.startsWith(`students/${first}/`), "wrong folder");
    return uploaded;
  });

  await step("the thumbnail went up alongside it", async () => {
    const meta = await head(thumbPathname(uploaded));
    assert.ok(meta.size > 0);
    return `${meta.size} bytes`;
  });

  await step("the blob is PRIVATE — an anonymous fetch is refused", async () => {
    const meta = await head(uploaded);
    const anon = await fetch(meta.url);
    assert.ok(
      anon.status === 401 || anon.status === 403,
      `a photograph of a child was readable without credentials (${anon.status})`,
    );
    return `${anon.status} on the raw blob URL`;
  });

  await step("a PNG wearing a JPEG content-type is refused", async () => {
    const body = new FormData();
    body.append("studentId", first);
    body.append("file", new Blob([new Uint8Array(PNG)], { type: "image/jpeg" }), "x.jpg");
    const response = await fetch(`${BASE}/api/r/${token}/photo`, {
      method: "POST",
      body,
    });
    assert.equal(response.status, 415, `expected 415, got ${response.status}`);
    return "415, sniffed from the bytes";
  });

  await step("a child outside the frozen roster is a 404", async () => {
    const response = await fetch(`${BASE}/api/r/${token}/photo`, {
      method: "POST",
      body: photoBody("NOT-ON-THIS-ROSTER", JPEG),
    });
    assert.equal(response.status, 404);
    return "404, no body";
  });

  await step("an unknown token cannot be used as a dropbox", async () => {
    const response = await fetch(`${BASE}/api/r/aaaaaaaaaaaaaaaa/photo`, {
      method: "POST",
      body: photoBody(first, JPEG),
    });
    assert.equal(response.status, 404);
    return "404";
  });

  console.log("\nReading it back");

  await step("her own link serves the photo", async () => {
    const response = await fetch(
      `${BASE}/api/r/${token}/photo?p=${encodeURIComponent(uploaded)}`,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.equals(JPEG), "the bytes came back different");
    return "byte-identical";
  });

  /*
   * ON THE WIRE, NOT IN THE CONFIG. tests/headers.test.ts models how Next
   * merges header rules; only a real response proves the model right. The photo
   * header spent its first version being silently overridden by the no-store
   * rule on the whole /api/r/* prefix, and nothing anywhere said so.
   */
  await step("the photo is cached, and the roster still is not", async () => {
    const [photo, answers, page] = await Promise.all([
      fetch(`${BASE}/api/r/${token}/photo?p=${encodeURIComponent(uploaded)}`),
      fetch(`${BASE}/api/r/${token}`),
      fetch(`${BASE}/r/${token}`),
    ]);

    const cache = photo.headers.get("cache-control") ?? "";
    assert.match(cache, /immutable/, `the photo says: ${cache || "(nothing)"}`);
    assert.match(cache, /private/, "a shared cache may hold a child's photograph");
    assert.doesNotMatch(cache, /no-store/, "the config rule is still overriding it");

    for (const [what, response] of [["answers", answers], ["form page", page]] as const) {
      const value = response.headers.get("cache-control") ?? "";
      assert.match(value, /no-store/, `the ${what} became cacheable: ${value}`);
    }

    // Never lost, image or not.
    assert.match(photo.headers.get("x-robots-tag") ?? "", /noindex/);
    assert.equal(photo.headers.get("referrer-policy"), "no-referrer");
    return cache;
  });

  await step("a pathname outside her roster is a 404", async () => {
    const elsewhere = photoPathname("SOMEONE-ELSE");
    const response = await fetch(
      `${BASE}/api/r/${token}/photo?p=${encodeURIComponent(elsewhere)}`,
    );
    assert.equal(response.status, 404);
    return "404";
  });

  await step("traversal in the query string is a 404", async () => {
    const response = await fetch(
      `${BASE}/api/r/${token}/photo?p=${encodeURIComponent("../../etc/passwd")}`,
    );
    assert.equal(response.status, 404);
    return "404";
  });

  await step("the office proxy refuses an unauthenticated read", async () => {
    const response = await fetch(`${BASE}/api/photos?p=${encodeURIComponent(uploaded)}`);
    assert.equal(response.status, 404, `expected 404, got ${response.status}`);
    assert.ok(
      (response.headers.get("x-robots-tag") ?? "").includes("noindex"),
      "the photo proxy is missing noindex",
    );
    return "404 with no session, noindex set";
  });

  console.log("\nThe answer, through the pipeline");

  await step("the pathname submits as an ordinary field value", async () => {
    const response = await fetch(`${BASE}/api/r/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        students: [
          { studentId: first, values: { phone: "9876543210", photo: uploaded } },
        ],
        idempotencyKey: `zzsmoke${Date.now().toString(36)}`,
      }),
    });
    assert.equal(response.status, 201, `expected 201, got ${response.status}`);
    const rows = await db
      .select()
      .from(schema.submissions)
      .where(
        and(
          eq(schema.submissions.requestId, scenario.requestId),
          eq(schema.submissions.studentId, first),
        ),
      );
    const photo = rows.find((row) => row.fieldKey === "photo");
    assert.ok(photo, "no photo submission row");
    assert.equal(photo!.action, "changed");
    assert.equal(photo!.newValue, uploaded);
    assert.equal(photo!.reviewStatus, "pending");
    return `${rows.length} rows, photo pending`;
  });

  await step("one child's photo cannot be pinned on another", async () => {
    // THE ONE THAT MATTERS. The face shown in the review queue would be a real
    // face from that class, so nothing downstream could catch this.
    const response = await fetch(`${BASE}/api/r/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        students: [{ studentId: second, values: { photo: uploaded } }],
        idempotencyKey: `zzsmoke${Date.now().toString(36)}x`,
      }),
    });
    assert.equal(response.status, 422, `expected 422, got ${response.status}`);
    const rows = await db
      .select()
      .from(schema.submissions)
      .where(
        and(
          eq(schema.submissions.requestId, scenario.requestId),
          eq(schema.submissions.studentId, second),
        ),
      );
    assert.equal(rows.length, 0, "a rejected batch still wrote rows");
    return "422, nothing written";
  });

  await step("a replayed batch writes nothing twice", async () => {
    const key = `zzsmokerepeat${Date.now().toString(36)}`;
    const send = () =>
      fetch(`${BASE}/api/r/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          students: [{ studentId: second, values: { phone: "9000000001" } }],
          idempotencyKey: key,
        }),
      });
    await send();
    await send();
    const rows = await db
      .select()
      .from(schema.submissions)
      .where(
        and(
          eq(schema.submissions.studentId, second),
          eq(schema.submissions.fieldKey, "phone"),
        ),
      );
    assert.equal(rows.length, 1, `expected 1 row, found ${rows.length}`);
    return "one row after two sends";
  });

  console.log("\nInto the master record");

  await step("approving writes photo_path on the student", async () => {
    const [pending] = await db
      .select({ id: schema.submissions.id })
      .from(schema.submissions)
      .where(
        and(
          eq(schema.submissions.requestId, scenario.requestId),
          eq(schema.submissions.studentId, first),
          eq(schema.submissions.fieldKey, "photo"),
        ),
      );
    assert.ok(pending, "nothing to approve");

    await decideSubmissions([pending!.id], "approved", scenario.userId);

    const [student] = await db
      .select({ photoPath: schema.students.photoPath })
      .from(schema.students)
      .where(eq(schema.students.id, first));
    assert.equal(student?.photoPath, uploaded, "photo_path was not written");
    return uploaded;
  });

  await step("the approval is in the change log", async () => {
    const rows = await db
      .select()
      .from(schema.changeLog)
      .where(
        and(
          eq(schema.changeLog.studentId, first),
          eq(schema.changeLog.fieldKey, "photo"),
        ),
      );
    assert.ok(rows.length > 0, "no change_log row");
    assert.equal(rows[0]!.decidedBy, scenario.userId);
    return `${rows.length} entry, decided by the test admin`;
  });

  await step("the child drops out of the 'no photo' work list", async () => {
    const missing = await listStudents({ missing: ["photo"], limit: 1000 });
    assert.ok(
      !missing.students.some((row) => row.id === first),
      "still listed as missing a photo",
    );
    const withPhoto = await listStudents({ search: first, limit: 10 });
    assert.equal(withPhoto.students[0]?.photoPath, uploaded);
    return `${missing.total} children still have none`;
  });

  console.log("\nThe office board");

  await step("filters compose, and the export reads the same string", async () => {
    const [all, byClass, noPhone] = await Promise.all([
      listStudents({ limit: 1 }),
      listStudents({ classes: ["12 Commerce"], limit: 1 }),
      listStudents({ classes: ["12 Commerce"], missing: ["phone"], limit: 1 }),
    ]);
    assert.ok(all.total >= byClass.total, "a class filter widened the result");
    assert.ok(byClass.total >= noPhone.total, "AND across dimensions widened it");
    return `${all.total} active, ${byClass.total} in 12 Commerce, ${noPhone.total} of those with no mobile`;
  });

  await step("the students board redirects a signed-out visitor", async () => {
    const response = await fetch(`${BASE}/students?houses=Rana+Pratap&missing=phone`, {
      redirect: "manual",
    });
    assert.ok(
      response.status === 307 || response.status === 302 || response.status === 200,
      `unexpected ${response.status}`,
    );
    return `${response.status}`;
  });

  await step("the export route refuses a signed-out visitor", async () => {
    const response = await fetch(`${BASE}/api/export/students.xlsx?missing=photo`);
    assert.equal(response.status, 401);
    return "401";
  });

  console.log("\nClearing a finished round");

  /*
   * The bulk bar's server actions all sit behind requireUser(), so a script
   * cannot call them. What CAN be checked without a session is the thing that
   * makes them correct: the database itself refuses to delete a request that
   * collected answers, which is why archiving is not a preference. If that
   * guarantee ever stopped holding, bulkRemoveRequests would look fine and
   * would be quietly destroying the audit trail.
   */
  await step("a request holding answers CANNOT be deleted by the app role", async () => {
    await assert.rejects(
      () => db.delete(schema.requests).where(eq(schema.requests.id, scenario.requestId)),
      "the delete succeeded — submissions are no longer protected",
    );
    const [still] = await db
      .select({ id: schema.requests.id })
      .from(schema.requests)
      .where(eq(schema.requests.id, scenario.requestId));
    assert.ok(still, "the request went anyway");
    return "refused, request intact";
  });

  await step("archiving hides it from the board and keeps the answers", async () => {
    await db
      .update(schema.requests)
      .set({ status: "closed", closedAt: new Date(), archivedAt: new Date() })
      .where(eq(schema.requests.id, scenario.requestId));

    const [visible, withArchived] = await Promise.all([
      listRequests({}),
      listRequests({ includeArchived: true }),
    ]);
    const id = scenario.requestId;
    assert.ok(!visible.some((row) => row.id === id), "an archived request is still on the board");
    assert.ok(withArchived.some((row) => row.id === id), "Show archived does not show it");

    const [answers] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.submissions)
      .where(eq(schema.submissions.requestId, id));
    assert.ok((answers?.n ?? 0) > 0, "the answers went with it");
    return `hidden, ${answers!.n} answers kept`;
  });

  await step("a request that collected nothing deletes, roster and all", async () => {
    const empty = await createScenario({ fieldKeys: ["phone"] });
    await db.delete(schema.requests).where(eq(schema.requests.id, empty.requestId));

    const [gone] = await db
      .select({ id: schema.requests.id })
      .from(schema.requests)
      .where(eq(schema.requests.id, empty.requestId));
    assert.ok(!gone, "it survived");

    const roster = await db
      .select({ studentId: schema.requestStudents.studentId })
      .from(schema.requestStudents)
      .where(eq(schema.requestStudents.requestId, empty.requestId));
    assert.equal(roster.length, 0, "the frozen roster was orphaned, not cascaded");
    return "deleted, roster cascaded";
  });
}

async function teardown() {
  console.log("\nCleaning up …");
  for (const pathname of blobsToDelete) {
    await del(pathname).catch(() => {});
  }
  if (blobsToDelete.length > 0) {
    console.log(`  removed ${blobsToDelete.length} blobs`);
  }
  await cleanup();
  console.log("  removed the ZZTESTSMOKE fixtures");
}

main()
  .then(teardown, async (error) => {
    console.error(`\nSMOKE TEST ABORTED: ${error instanceof Error ? error.message : error}`);
    await teardown().catch(() => {});
    process.exitCode = 1;
  })
  .then(() => {
    const failed = results.filter((result) => !result.ok);
    console.log(
      `\n${results.length - failed.length}/${results.length} checks passed.`,
    );
    if (failed.length > 0) {
      console.log("\nFailures:");
      for (const failure of failed) {
        console.log(`  - ${failure.name}: ${failure.detail}`);
      }
      process.exitCode = 1;
    }
  });
