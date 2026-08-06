# Prompt 3 — the PSP export, and what it changes about prompt 2

The PSP Student Data Entry Report arrived: two files, 89 + 415 = **504 rows**,
exactly matching the 504 active students in the fee-app bundle. PSP is the
official record and carries all the identity data the fee app lacks.

**This partly reverses Part A3 of prompt 2.** That prompt said seven `verify`
fields were empty and should become `collect`. With PSP imported, five of them
are ~100% populated and belong back in `verify`. Read the block below before
acting on A3.

Paste the block into Claude Code.

---

```
The PSP export has arrived and it is the identity master. Two files, 89 + 415
rows, 504 total — exactly the 504 active students in the fee-app bundle.

IMPORTANT — this reverses part of the previous prompt. Prompt 2 Part A3 told you
that father_name, mother_name, dob, aadhaar, jan_aadhaar, village and category
are empty for 100% of students, and to reseed all seven as mode='collect'. That
was true of the fee-app export. It is NOT true once PSP is imported:

    Father Name      504/504   100%   → keep as 'verify'
    Mother Name      504/504   100%   → keep as 'verify'
    DOB              504/504   100%   → keep as 'verify'
    Gender           504/504   100%   → new field, 'verify'
    Social Category  504/504   100%   → keep as 'verify'
    aadhaar            0/504     0%   → 'collect'  (see C4 — PSP's is masked)
    jan_aadhaar        0/504     0%   → 'collect'
    village            0/504     0%   → 'collect'  (see C6)

So: only aadhaar, jan_aadhaar and village become 'collect'. The other four stay
'verify', and add gender.

=====================================================================
PART A — the file format will break your importer
=====================================================================

The PSP files have a .xls extension but they are NOT Excel files. They are HTML
documents containing a single <table>, saved with the wrong extension. ExcelJS
will throw on them.

Detect by content, not extension: read the first bytes and if it looks like HTML
(`<html`, `<table`, or a BOM followed by either), parse it as an HTML table.
Otherwise hand it to ExcelJS. Say so in the import UI — "PSP report (HTML
table)" vs "Excel workbook" — so the office knows the file was understood.

Each file is one table, 44 columns, header in the first row.

=====================================================================
PART B — the primary key
=====================================================================

B1. USE `Student NIC ID`, NOT SR No.

    Student NIC ID is 9 digits and is unique across all 504 rows.

    SR No. is NOT unique. Three SR numbers are each shared by two DIFFERENT
    children:

        202200012  →  a PP.3+ child (DOB 2022) and a Class 3 child (DOB 2017)
        202200013  →  a PP.3+ child (DOB 2022) and a Class 3 child (DOB 2018)
        202200016  →  a PP.4+ child (DOB 2021) and a Class 3 child (DOB 2018)

    These are real collisions in the school's records, not an export artefact.
    The build plan says "student ID first, then SR number, never name" — that
    still holds, but Student NIC ID is now the student ID. Store SR No as
    students.sr_no and keep matching on it as a fallback, but the moment a
    fallback SR match is ambiguous, refuse the row and report it rather than
    guessing. A wrong join here silently merges two children's records.

    `Admission Number/SR No` is identical to `SR No.` in all 504 rows. Ignore it.

B2. THE TWO SOURCES DO NOT FULLY OVERLAP.

        SR present in both sources    474
        SR only in PSP                 27
        SR only in the fee app         30

    Do not treat a non-match as an error. Import PSP as the master identity
    record; where the fee app has a student PSP does not, keep it — that student
    is enrolled and paying. Report both sets of orphans in the dry-run so the
    office can reconcile. Roughly 6% won't join and that is expected.

=====================================================================
PART C — column mapping, and four traps
=====================================================================

Straightforward:
    Student NIC ID    → students.id
    SR No.            → sr_no
    Student Name      → name
    Father Name       → father_name
    Mother Name       → mother_name
    Gender            → gender          (Male 258 / Female 246)
    Mobile Number     → phone
    Date of Admission → (ignore for now, or add a column later)

C1. DOB IS DD/MM/YYYY. Every value, 504/504, e.g. "29/06/2022".
    Parse it explicitly as day-first. Do not hand it to `new Date()` and do not
    let a library guess — "01/10/2022" is 1 October, and a month-first parse
    turns it into 10 January and nobody notices for a year.

C2. SOCIAL CATEGORY DOES NOT MATCH THE SEEDED OPTIONS.
    PSP values, all 504 filled:
        GENERAL 223, OBC 186, SC 46, SBC 45, ST 4
    The registry currently seeds GEN/OBC/SC/ST/EWS. Two problems: PSP says
    GENERAL not GEN, and SBC (45 students) is not in the list at all, while EWS
    appears in zero rows. Update the options to what the school actually uses —
    GENERAL, OBC, SC, SBC, ST — and keep EWS only if the office says they need
    it. An import that silently drops 45 SBC students is worse than a failure.

C3. CLASS LABELS ARE A THIRD CONVENTION. Map to the 19 fee-app labels from
    prompt 2:

        PP.3+ → Nursery      First  → Class 1     Sixth   → Class 6
        PP.4+ → JKG          Second → Class 2     Seventh → Class 7
        PP.5+ → SKG          Third  → Class 3     Eight   → Class 8
                             Fourth → Class 4     Ninth   → Class 9
                             Fifth  → Class 5     Tenth   → Class 10

        Eleventh + Stream → "11 Arts" | "11 Commerce" | "11 Science"
        Twelth   + Stream → "12 Arts" | "12 Commerce" | "12 Science"

    Note PSP spells them "Eight" (not Eighth) and "Twelth" (not Twelfth). Match
    their spelling exactly; do not silently accept both.

    BUT THE STREAM COLUMN IS UNRELIABLE. Of the 84 students in Eleventh and
    Twelth, 45 have Stream = "Not Applicable". You cannot derive their section
    from PSP. The fee app has the correct stream for those students — take the
    class label from the FEE APP for anyone in class 11 or 12, and use PSP only
    for classes Nursery–10.

    Class disagreements between the two sources, on the 474 joined rows: 62
    total. 45 are the stream problem above. The remaining 17 are genuine
    conflicts — 5 students PSP calls 11 Science that the fee app calls 11 Arts,
    2 the reverse, and a handful where PSP says Class 3 but the fee app says
    Nursery or JKG. Do not resolve these in code. List them in the dry-run and
    make the office decide.

C4. AADHAAR IS MASKED. DO NOT IMPORT IT INTO `aadhaar`.
    328 of 504 rows have exactly FOUR digits — the last four only. 176 are
    empty. There is not a single full 12-digit number in the file.
    The registry defines aadhaar with exactLen 12. Writing a 4-digit masked
    suffix into that column would look like real data and fail validation
    forever after. Either drop the column entirely on import, or land it in a
    clearly separate `aadhaar_last4` and never let it satisfy the aadhaar field.
    Aadhaar collection stays a teacher job.

C5. MOBILE NUMBER IS THE BIG WIN — AND THE BIG CONFLICT.
    All 504 rows have a mobile number and every one is exactly 10 digits.
    Against the fee app, on the 474 joined rows:

        PSP number matches a fee-app number       253
        PSP has a number the fee app is missing   114
        PSP and fee app DISAGREE                  109
        fee app has one PSP is missing              0

    So PSP fills every blank and never loses information — but it disagrees with
    the fee app for 109 students, about 23%.

    Do not silently overwrite. Import PSP's number as the master value, and for
    those 109, create the conflict as something the office can see: they are
    exactly the rows worth putting in front of a class teacher first. If you can
    flag them so a request can be built from "students whose number is disputed",
    do that — it turns the conflict into the first useful teacher task.

    61 mobile numbers are shared by more than one student. Siblings. Still not
    an error, per prompt 2 B4.

C6. `Habitation or Locality` IS A FREE-TEXT ADDRESS, NOT A VILLAGE.
    Only 41% filled, and the values look like
    "WARD NO 07 AMET" / "jato ki pol amet" / "REGAR MOHALLA, RAILWAY STATION,
    AMET, RAJSAMAND, 313332". Mixed case, mixed language, sometimes a PIN code.
    Map it to students.address, not village. `village` stays a collect field.
    Do not try to parse a village out of it.

C7. FIELDS TO IGNORE. Most of the 44 columns are government scheme reporting
    and do not belong in Sampark: BPL, Disadvantaged Group, Free Education,
    uniform sets, textbooks, transport, escort, MDM, hostel, special training,
    exam results, iron/folic acid, deworming, vitamin A, CWSN facilities,
    disability type, days attended. Leave them in PSP. Sampark collects what the
    school needs to keep current, not everything PSP stores.
    Religion (Hindu 494, Jain 6, Muslim 4) and Mother Tongue (Hindi 448) are
    real but nobody has asked to keep them current — skip unless I say otherwise.

=====================================================================
PART D — casing
=====================================================================

PSP names are inconsistently cased: 417 of 504 student names are ALL CAPS and 87
are mixed ("Khushi Parmar", "Parth suthar"). Parent names: 409 of 504 ALL CAPS.

Store exactly what the source says. Title-case at RENDER time only, as prompt 2
A2 already requires. Do not normalise casing on import — the moment you rewrite
a name on the way in, you have lost the ability to show the office what PSP
actually holds, and the diff against a teacher's correction becomes noise.

=====================================================================
PART E — order of work
=====================================================================

1. Finish the class-label fix from prompt 2 A1. Everything here depends on it.
2. HTML-table detection in the importer.
3. Import PSP keyed on Student NIC ID, with the fee app supplying class for 11
   and 12, and active/left status and bus_route for everyone.
4. Re-run the field registry seed with the corrected verify/collect split from
   the top of this prompt, the real category options, and gender added.
5. Then the teacher-screen work in prompt 2 Part B.

The blanks-first split in prompt 2 B1 still matters, but the numbers change
completely once PSP lands: phone goes from 118 missing to 0, and the first real
teacher task becomes the 109 disputed numbers rather than the empty ones. Build
B1 so it groups on "needs your attention" — empty OR disputed — not on empty
alone.

PII: these files hold 504 real names, parents' names, DOBs and phone numbers.
They go in /private/. Never into a test, a fixture, a seed, a comment or a
commit message.

Verify with npx tsc --noEmit && npx eslint . && npm run build, then tell me:
  - how many of the 504 imported cleanly, and what the orphans were
  - the 17 genuine class conflicts, as a list I can take to the office
  - whether you dropped Aadhaar or parked it in aadhaar_last4

Tell me your plan before writing code.
```
