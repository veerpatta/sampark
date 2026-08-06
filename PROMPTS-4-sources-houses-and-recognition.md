# Prompt 4 — source precedence, houses, and helping the teacher recognise the child

Three things arrived at once and they are really one thing.

1. The fee app is authoritative for **class allocation**. PSP is authoritative
   for **student identity**. That is a rule, not a one-off import decision.
2. A house list arrived — 151 students, a field nothing else holds.
3. More files are coming, each covering some students and some fields, and some
   of them will have no student ID at all.

So the change is architectural: stop writing one-off importers and give Sampark
a notion of **where a value came from and which source outranks which**.

Paste the block below into Claude Code.

---

```
Three things at once, and they are one thing. Read all of it before planning.

=====================================================================
PART A — source precedence. This is the real change.
=====================================================================

Correction to prompt 3 C3 first: I said take the class label from PSP for
Nursery–10 and from the fee app for 11 and 12. Simplify — THE FEE APP IS
AUTHORITATIVE FOR CLASS ALLOCATION, always, every class. PSP is authoritative
for who the child is. Those are standing rules.

I am going to keep feeding files in. Each one covers some of the students and
some of the fields, and each is better than the others at something. A one-off
importer per file does not survive that: the third file silently overwrites what
the second one got right.

Build this instead.

A1. A `sources` table. One row per place data can come from:

      key            label                     kind
      psp            PSP Student Data Report   import
      fees           Fee Management App        import
      election       House / election list     import
      teacher        Teacher submission        collected
      office         Office manual edit        manual

A2. A `field_sources` table — which source wins for which field. Data, not a
    switch statement, because I will change my mind about this:

      class_label, section, status, bus_route   → fees
      name, father_name, mother_name, dob,
        gender, category, phone                 → psp
      house                                     → election
      everything else                           → whoever wrote it first

    An APPROVED TEACHER SUBMISSION OUTRANKS EVERY IMPORT, always, for every
    field. A teacher who corrected a number and had it approved must never be
    undone by re-importing an old PSP export. This is the rule that matters most
    — it is the difference between the tool being trusted and being abandoned.

A3. Record provenance per value. Add to `students`, or to a side table keyed on
    (student_id, field_key), whichever you judge cleaner — but justify the choice
    to me before you build it:

      source_key, source_updated_at

    On import, for each incoming value: if the incoming source outranks the
    stored source, write it. If it does not, keep the stored value and count it
    as "skipped — lower precedence". Show both counts in the dry-run.

A4. The dry-run must now report FOUR outcomes, not three:
      would insert · would update · would skip (blank cell) ·
      would skip (lower-precedence source)
    That last one is the one that stops a well-meaning re-import from undoing a
    month of teacher corrections, so make it visible, not a silent no-op.

=====================================================================
PART B — houses
=====================================================================

New field in the registry, `house`, input_type select, mode verify, four options.
The election file writes them with a "House" suffix; store the short form:

      Rana Pratap   — red     (file says "Rana Pratap House")
      Rana Kumbha   — blue    ("Rana Kumbha House")
      Bappa Rawal   — green   ("Bappa Rawal House")
      Rana Sanga    — yellow  ("Rana Sanga House")

Hindi labels: राणा प्रताप, राणा कुम्भा, बप्पा रावल, राणा सांगा.

Carry the colour. A house is the one field a child answers instantly and a
teacher can verify at a glance, so render it as a coloured chip, not text in a
dropdown. Add the four colours to tokens.css rather than inlining hex.

The file: `Voter Name, Voter Type, Class & Section, Roll Number / Admission
Number, House, Department / Role`. 151 rows, all Voter Type = student. Roll
Number is empty in every row — ignore the column. Class & Section already uses
the fee-app labels exactly ("Class 8", "11 Science", "12 Arts"), so no mapping
needed.

Coverage is 151 of 504 — about 30%. The other 353 have no house recorded
anywhere, which is exactly the sort of gap this app exists to close: seed what
we have, then let a house-allocation request collect the rest.

=====================================================================
PART C — matching a file that has no student ID
=====================================================================

The election file has no SR number and no NIC ID. Only name, class and house.
The build plan says never match on name, and that rule exists for a good reason.
Refine it rather than break it:

    NEVER match on name to write master data unattended.
    A name match may only ever produce a PROPOSED change in the review queue,
    which is what every teacher submission already is.

That is consistent with the whole design: nothing reaches master without a human
approving it. So build a tiered matcher, scoped to one class at a time, and make
it refuse rather than guess.

I have already measured all four tiers against the real 151 rows:

    Tier 1  exact, after normalising                          111
            (uppercase, strip punctuation, collapse spaces)
    Tier 2  one name's tokens are a subset of the other's       14
            "Sapna Kanwar Chundawat" ↔ "SAPNA KANWAR"
            "Nidhiraj Chundawat"     ↔ "NIDHIRAJ KANWAR CHUNDAWAT"
    Tier 3  fuzzy, similarity ≥ 0.86                             8
            "Namrata Kanwar Chouhan" ↔ "NAMRTA KUNWAR CHOUHAN"
            "Akshita Gautam"         ↔ "AKSHITA GOUTAM"
    Tier 4  no candidate in that class                          18

    Ambiguous at any tier: ZERO.

Rules:
  - Always scope candidates to the class named in the file. Never search the
    whole school. Class scoping is what keeps this safe.
  - More than one candidate at any tier → do not pick. Emit it for a human,
    showing every candidate.
  - Record the tier on the proposed change. A tier-3 fuzzy match must be visibly
    different in review from a tier-1 exact one; the office should be able to
    approve all the tier-1s in one action and read the tier-3s one at a time.
  - Search ALL sources, not just the fee app. Of the 18 with no fee-app match,
    7 ARE in PSP — Poonam, Harshit Suthar, Rajveer, Priya Salvi, Simran Soni,
    Harshit Mehta, Aishwariya Teli. A single-source matcher would have thrown
    those away.
  - The genuine leftovers are still useful. Report them as "in the house list,
    not in any roster" — that is either a new admission nobody entered or a
    name spelled two different ways, and both are worth knowing.

Do not hardcode these numbers. They are what my measurement produced today; the
next file will differ. They are here so you can sanity-check your matcher —
if you run it against this file and do not get roughly 111 / 14 / 8 / 18 with no
ambiguity, something is wrong.

=====================================================================
PART D — help the teacher recognise the child
=====================================================================

This is the point of the whole exercise, and it is worth saying plainly.

When I send a request asking Class 8 to fill in father's name, the teacher gets
a list of 46 children. She knows these children by face and by nickname. She
does not know them as a row in a spreadsheet. Every scrap of identifying data we
hold makes it faster for her to be sure which child she is answering for — and
"being sure" is the whole product.

So on the teacher screen, each row shows the field(s) being ASKED FOR as inputs,
and everything else we know as quiet context:

      name (title-cased)
      SR no, small and monospaced
      house, as its coloured chip
      route / village
      father's name, if we have it
      class is in the sticky header, not repeated per row

Context is read-only and visually recessive — smaller, muted, never competing
with the input. She is not confirming it; she is using it to recognise a child.

Two consequences worth building for:
  - The more fields get filled, the better every FUTURE request works. A house
    collected in September makes the January request easier. Say this in the
    admin UI when a request is created — "these 151 students will show their
    house as a recognition aid" — because it is the reason to keep collecting.
  - Never let context leak beyond the class. The token scopes one class and that
    does not change because we are now showing more per row.

=====================================================================
PART E — order, and the things I do not want
=====================================================================

Order: A (precedence) before anything else, because B and C both write through
it. Then B, then C, then D.

Do NOT:
  - resolve a class conflict between two sources in code — precedence decides,
    and where precedence does not decide, a human does
  - auto-approve a name match at any tier, including tier 1
  - let an import touch a field whose current value came from an approved
    teacher submission
  - build a general fuzzy search across all 504 students; class-scoped only

PII: the house file has 151 real student names. /private/, never committed.

Verify with npx tsc --noEmit && npx eslint . && npm run build, then tell me:
  - where you put provenance and why
  - your matcher's tier counts against the real file
  - what happens if I re-import the old PSP file after a teacher correction has
    been approved — I want to hear "nothing changes", and I want to see the test

Tell me your plan before writing code.
```
