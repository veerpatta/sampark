# Prompt 2 — real data, and making the teacher screen survive it

Context: Phases 1–6 are built. A real export of all 504 students arrived and it
breaks three assumptions the code was written against. This prompt fixes those,
then rebuilds the teacher screen around what the data actually looks like.

Paste the block below into Claude Code from the repo root.

---

```
The real student export has arrived — 504 active students across 19 classes —
and I have analysed it. Three assumptions in the current code are wrong. Fix
those first, then rebuild the teacher screen around what the data actually is.

Read SAMPARK_BUILD_PLAN.md and PROMPTS.md first if you have not. Every rule in
PROMPTS.md still applies, especially: the repo is PUBLIC, and no real student
name, phone number or SR number may ever be committed — not in tests, not in
fixtures, not in seed files.

=====================================================================
PART A — three things the data proves wrong
=====================================================================

A1. CLASS LABELS ARE WRONG. This is the one that silently returns empty
    rosters, so fix it first.

    src/lib/classes.ts settled on labels like `6`, `10 A`, `12 Sci`. The fee
    management app is the source of truth and uses these 19 labels, exactly:

      Nursery, JKG, SKG,
      Class 1, Class 2, Class 3, Class 4, Class 5, Class 6, Class 7, Class 8,
      Class 9, Class 10,
      11 Arts, 11 Commerce, 11 Science,
      12 Arts, 12 Commerce, 12 Science

    Sampark must use these character for character, because corrected data goes
    back to the fee app and the two must join on class label.

    compareClassLabels() is also broken for these: it parses a LEADING digit,
    so "Class 6" and "Nursery" both fall through to Infinity and then sort
    alphabetically. Replace it with an explicit ordered list — Nursery, JKG,
    SKG, Class 1..10, then 11 and 12 with Arts/Commerce/Science. Sorting these
    19 known labels by a fixed index is honest; a clever parser is not.

    Make the 19 labels a single exported constant and have the importer, the
    teacher editor and the request builder all validate against it. A class
    label that is not in the list should be a loud import error, not a new row.

A2. THERE ARE NO ROLL NUMBERS AND NO PARENT NAMES.

    The export has: SR no, Student, Class, Status, Student type, Route,
    Father phone, Mother phone. That is all the identity data that exists.

    So right now every card renders `{rollNo}.` as nothing and
    `पिता: {fatherName}` as nothing, and worse — lib/requests.ts orders the
    roster by rollNo, which is null for all 504 students. Every class comes out
    in arbitrary order. A teacher gets an unordered list of ALL-CAPS English
    names with no other identifying mark.

    Fix:
      - Order the roster by student name (locale-aware), not rollNo. Keep the
        rollNo column and the ordering support for later; just do not depend on
        it. Alphabetical is the only order she can predict today.
      - Show SR no on the card, small and monospaced. It is the only stable
        identifier she can cross-check against a paper register.
      - Show Route under the name when known — in a village school that is real
        identifying context, and it is present for 51% of students.
      - Drop the father-name line until that data exists. An empty label is
        worse than no label.
      - Names are stored ALL CAPS (483 of 504). Render them in title case. A
        Hindi-first screen shouting ANSHUL KUMAWAT at her reads as an error
        message. Store as-is, display title-cased.

A3. SEVEN OF THE TEN "VERIFY" FIELDS HAVE NOTHING TO VERIFY.

    Coverage across the 504 active students:

      Father phone   386/504   77%
      Mother phone   284/504   56%
      Route          257/504   51%
      father_name, mother_name, dob, aadhaar, jan_aadhaar, village, category
                       0/504    0%   ← all seeded as mode='verify'

    A verify-mode field with no stored value shows "खाली है" and asks her to
    confirm nothing. Reseed those seven as mode='collect' so they open their
    inputs directly. Leave phone, alt_phone (which maps to Mother phone) and
    bus_route as 'verify'.

    Also seed the 29 real bus routes into bus_route.options — they are in the
    Routes sheet of the context bundle. "No Transport" is one of them and must
    stay, it is a real answer.

    And map the field registry onto the real column names:
      phone      ← Father phone
      alt_phone  ← Mother phone   (relabel it "माता का नंबर", not "दूसरा नंबर")
      bus_route  ← Route

=====================================================================
PART B — the teacher screen
=====================================================================

The design premise was "she is confirming, and correcting a few". Against the
real data that is only half true, and the half that is wrong is the half that
matters:

      Class          students   father phone missing
      Nursery            20         17
      11 Arts            25         16
      SKG                30         12
      Class 1            40          9
      Class 3            39          7
      Class 6            43          6
      Class 8            46          6
      12 Commerce         5          0
      ---------------------------------------------
      All classes       504        118

    Mother phone is missing for 220 of 504. Route for 247 of 504.

So a Class 8 teacher opens the link and sees 46 identical cards, of which 40
are already correct and 6 are the entire point of sending her the link. She has
to scroll and hunt for them. And confirming the 40 costs 40 taps.

Rebuild the screen around that. Target: Class 8 goes from 46 taps to about 7.

B1. SPLIT THE ROSTER INTO TWO GROUPS, blanks first.

    Top group, heading like:
      "६ बच्चों की जानकारी नहीं है — ये सबसे ज़रूरी हैं"
    These are rows where every requested field is empty. They open with their
    inputs already visible — there is nothing to confirm, so do not make her
    tap to reveal a keyboard.

    Second group, heading like:
      "४० बच्चों की जानकारी पहले से है — देखकर बता दें कि सही है"

    If a class has no blanks, do not render the first group or its heading at
    all. If a class is ALL blanks (Nursery is close), do not render the second.
    An empty section with a zero in it is noise.

B2. ONE BUTTON CONFIRMS THE WHOLE SECOND GROUP.

    A single primary action at the top of the second group:
      "सब सही हैं" — with the count in it.

    Tapping it marks every unanswered row in that group confirmed. Rows stay
    individually tappable afterwards, so she can still open one and correct it;
    doing so pulls that row back out of confirmed. This is the whole feature:
    the common case is one tap, the exceptions stay one tap each.

    Two things this must NOT become:
      - It must not touch the blanks group. Never mass-confirm a row that has
        no value; that would write "confirmed" against an empty field and the
        office would think it was checked.
      - It must not auto-submit. She confirms, then sends. Keep those separate.

    Put a quiet undo next to it for the ten seconds after — "वापस लें" — because
    the one thing worse than 40 taps is 40 taps undone one at a time.

B3. MAKE THE NUMBER PAD THE ONLY KEYBOARD SHE EVER SEES.

    Phone and Aadhaar inputs: inputMode="numeric", autoComplete="off",
    and strip every non-digit on input rather than rejecting after the fact.
    She will paste a number with spaces or +91 in it; take it and clean it.
    Accept a leading +91 or 0 and drop it silently — do not show an error for
    something you can fix.

    Show the count as she types — "७ / १०" — so she knows why the row is not
    finished yet. Do not show a red error until she has typed 10 digits or
    left the field. Validating angrily on the first keystroke is what makes
    people give up.

B4. NEVER TREAT A REPEATED PHONE NUMBER AS AN ERROR.

    134 numbers in this school are shared by more than one student, and 133 of
    those span more than one class. Siblings share a parent's phone. If any
    validation, import check or review warning flags a duplicate phone, remove
    it. If you want to surface it at all, surface it in the ADMIN review screen
    as neutral information ("यह नंबर 2 और बच्चों पर भी है"), never to the teacher
    and never as a warning.

B5. THE PROGRESS LINE SHOULD COUNT WHAT IS LEFT, NOT WHAT IS DONE.

    "अभी ६ बाकी हैं" beats "40/46 हो गए". She wants to know when she can stop.
    Keep the two-state truth that is already there and is correct — saved on
    phone vs sent to school — do not collapse it.

B6. SMALL THINGS THAT COST NOTHING AND MATTER.

    - Every tappable target at least 48px, including "नहीं है", which is
      currently an underlined text link and is the easiest thing on the screen
      to mis-tap. Make it a proper button and move it out of thumb-collision
      range of "सही है".
    - "फिर से देखें" only appears on rows she has already answered. Right now
      the action row is crowded before she has done anything.
    - Use Devanagari digits consistently. toHindiDigits already exists; the
      "७ / १०" counter and every count in a heading should use it.
    - A sticky header with the class name and what is being asked, so if she
      puts the phone down and comes back she knows what screen she is on.

=====================================================================
PART C — importing the real data
=====================================================================

The export is an .xlsx with a "Students" sheet, 24 columns, 532 rows of which
504 are Status='active' and 28 are 'left'. Import only the active ones; map
'left' to students.status='left' if you import them at all.

Column mapping:
    SR no          → students.sr_no   AND students.id if you have no better key
    Student        → name
    Class          → class_label   (validate against the 19)
    Route          → bus_route
    Father phone   → phone
    Mother phone   → alt_phone
    Status         → status ('active' | 'left')

Everything else in that sheet is fee data and does not belong in Sampark.
Do not import Tuition fee, Outstanding, Total paid or any of it. Sampark is not
a fee system; the fee app already owns that and duplicating it creates two
sources of truth for money.

Data quality, already checked, so do not write defensive code for problems that
do not exist: all 670 phone values are exactly 10 digits with no separators and
no country code; there are no duplicate SR numbers; no names contain Devanagari.

PII HANDLING — this matters more than anything else in this prompt:
    - The .xlsx goes somewhere gitignored. Add /private/ to .gitignore and put
      it there, or keep it outside the repo entirely.
    - Never paste a real name, phone number or SR number into a test, a
      fixture, a seed file, a comment or a commit message.
    - If you need test data, generate it. Fake names, phones like 9000000001.

=====================================================================
Verifying
=====================================================================

npx tsc --noEmit && npx eslint . && npm run build must all pass.

Then tell me, honestly:
  - how many taps a Class 8 teacher now needs to finish a phone-number request
    if every stored number happens to be correct
  - what you changed about the 19 class labels and where they are enforced
  - anything in Part B you did not build

Do not report this done until you have opened /r/<a real token> on a phone-sized
viewport and confirmed the blanks group renders first.

Start by telling me your plan. Do not write code yet.
```
