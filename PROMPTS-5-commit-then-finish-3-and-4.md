# Prompt 5 — commit prompt 2, then do 3 and 4 as one piece of work

I inspected the repo. Prompt 2 is done and it is good. Prompts 3 and 4 have not
been started — I checked for their markers and found none:

    HTML .xls detection      absent
    Student NIC ID as key    absent
    aadhaar_last4            absent
    gender field             absent
    SBC / GENERAL options    absent
    sources table            absent
    field precedence         absent
    house field              absent
    per-value provenance     absent

Everything prompt 2 produced is also **uncommitted** — 20 modified files and 2
new ones sitting in the working tree. That is the first thing to fix.

Verified before writing this: `npx tsc --noEmit` clean, `npm test` 80 pass / 0
fail, migrations still at `0000` and `0001`.

Paste the block below into Claude Code.

---

```
Good work on prompt 2. I checked it: 19 canonical class labels are in and
enforced, the blanks-first split and "सब सही हैं" bulk confirm are built, names
render title-cased, the roster sorts by compareStudentNames instead of the null
rollNo, and there are 80 passing tests including a new roster suite. tsc and the
test run are both clean.

Two problems.

FIRST: none of it is committed. 20 modified files and 2 untracked
(scripts/fix-teacher-classes.ts, tests/roster.test.ts) are sitting in the working
tree. Commit that now, before anything else, as its own commit — I want the
teacher-UX work to have its own place in the history rather than being swept in
with the data-layer changes that come next. Write the message yourself; describe
what changed about the teacher screen and why, not a file list.

SECOND: prompts 3 and 4 have not been started. Both are committed in the repo:

    PROMPTS-3-psp-identity-import.md
    PROMPTS-4-sources-houses-and-recognition.md

Read both in full. Do NOT execute them in sequence — they overlap, and 4
corrects 3. Merge them into one plan, applying these reconciliations:

R1. CLASS ALLOCATION. Prompt 3 C3 says take the class label from PSP for
    Nursery–10 and from the fee app for 11 and 12. That is superseded. Prompt 4
    Part A is correct and final: THE FEE APP IS AUTHORITATIVE FOR CLASS
    ALLOCATION, every class, always. You still need the PSP class-name mapping
    table from 3 C3 (PP.3+ → Nursery, Eight → Class 8, and note PSP's spellings
    "Eight" and "Twelth"), but only to detect and report disagreements — never
    to decide one.

R2. BUILD PRECEDENCE FIRST. Prompt 4 Part A — the sources table, the
    field_sources map, per-value provenance — must exist before the PSP import
    in prompt 3 runs. Otherwise the PSP import is another one-off writer and you
    will have to unpick it. Order:

        1. commit prompt 2
        2. prompt 4 Part A          (precedence + provenance)
        3. prompt 3 Parts A–D       (PSP import, through precedence)
        4. prompt 4 Parts B, C      (houses, name matching)
        5. prompt 4 Part D          (recognition context on the teacher screen)

R3. THE FIELD REGISTRY IS TOUCHED BY BOTH. Do one seed rewrite, not two:
      - father_name, mother_name, dob, category stay mode='verify'  (prompt 3)
      - aadhaar, jan_aadhaar, village become mode='collect'          (prompt 3)
      - add gender, verify, options Male/Female                      (prompt 3)
      - category options become GENERAL, OBC, SC, SBC, ST            (prompt 3)
      - add house, verify, select, four options with colours         (prompt 4)
      - bus_route options get the 29 real routes                     (prompt 3)

R4. ONE MIGRATION, NOT FOUR. You are adding provenance columns, a sources
    table, a field_sources table, possibly aadhaar_last4, and a house value.
    Generate them as a single migration so the schema does not arrive in
    fragments that each half-work.

R5. PART D DEPENDS ON EVERYTHING ELSE. The recognition context in prompt 4 Part
    D — showing SR, house chip, route, father's name beside the field being
    asked for — only has anything to show once the imports have run. Build it
    last and demo it against real imported data, not fixtures.

Also, one thing I noticed reviewing your prompt-2 work that neither prompt
covers: scripts/fix-teacher-classes.ts is a one-off repair script sitting
untracked in the repo. Either fold what it does into the importer so the repair
is not needed twice, or move it under scripts/ with a comment saying what it
fixed and when. A loose script that mutates data and nobody remembers running is
how a database drifts.

Constraints unchanged and still binding:
  - the repo is PUBLIC; the four data files go in /private/, never committed
  - no real name, phone, SR number or NIC ID in a test, fixture, seed, comment
    or commit message
  - an approved teacher submission outranks every import, forever
  - a name match may only ever produce a proposed change in the review queue

When you are done, tell me:
  - where provenance lives and why you chose that shape
  - your matcher's tier counts against the real 151-row house file — I measured
    111 exact / 14 token-subset / 8 fuzzy / 18 absent, zero ambiguous, so treat
    a materially different result as a bug in the matcher
  - how many of the 504 imported cleanly and what the orphans were
  - the 17 genuine class conflicts, as a list I can take to the office
  - what happens if I re-import the old PSP file after a teacher correction has
    been approved. I want to hear "nothing changes", and I want to see the test

npx tsc --noEmit, npm test and npm run build must all pass before you report
done. Tell me your plan first — I want to see the merged ordering before you
write code.
```
