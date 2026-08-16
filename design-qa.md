# Calm Checklist Design QA

## Comparison target

- Source visual truth: `C:\Users\veer patta public sh\.codex\generated_images\019fea28-a318-7e43-ad15-63e9115c6a56\exec-170fdfca-0366-4ffa-a8d9-76fe532b3408.png`
- Browser-rendered implementation: `D:\Codex\scratch\sampark-calm-production-390x844-synced.png`
- Combined full-view evidence: `D:\Codex\scratch\sampark-calm-design-comparison-passed.png`
- Additional small-screen evidence: `D:\Codex\scratch\sampark-calm-final-360x800-current.png`
- Review-state evidence: `D:\Codex\scratch\sampark-calm-review-360x800.png`
- CSS viewport: 390 × 844 for the primary comparison; 360 × 800 for the small-screen check.
- Source pixels: 853 × 1844. Implementation capture pixels: 375 × 812 because the in-app browser reserves its scrollbar and browser surface inside the 390 × 844 override.
- Density normalization: both artifacts were rendered into equal 390 × 844 CSS boxes in the combined comparison. The near-identical source and implementation aspect ratios were preserved; device chrome was excluded from both.
- State: first missing student open, phone field focused, sibling suggestion visible, one completed answer acknowledged by the school, sticky progress rail active.

## Full-view comparison evidence

The final combined comparison shows the same Calm Checklist hierarchy: compact blue request header, two-part green instruction strip, numbered student rows, a single emphasized active student, missing-count labels, focused phone input, sibling suggestion, light dividers, collapsed following rows, explicit progress/sync truth, and one primary review action.

## Focused region evidence

Focused checks were made on the header/instruction strip, active student fields, sibling suggestion, collapsed student row, sticky progress rail, and the 360px review receipt. Separate image crops were not required because each of these regions remains readable at the normalized comparison size and was also exercised directly in the browser.

## Required fidelity surfaces

- Fonts and typography: Anek Latin and Devanagari remain the app fonts. English stays primary, Hindi sits directly underneath, input text remains at least 16px, and the compact hierarchy matches the selected reference without truncating essential labels.
- Spacing and layout rhythm: header and guide heights were reduced after the first pass. Cards were replaced by dividers and one active-row surface. The 360px layout retains safe wrapping and the sticky rail does not hide the current input.
- Colors and visual tokens: the implementation uses existing Sampark brand, confirmation, warning, border, ink, and muted-surface tokens. Every colored state also has text and/or an icon.
- Image and icon fidelity: the screen has no custom image assets. Phosphor icons are used for check, cloud, mobile, review, arrow, and chevron symbols; no handcrafted SVG, CSS drawing, or emoji substitutes remain in the redesigned areas.
- Copy and content: the long introduction was replaced with one immediate instruction and one autosave reassurance. Labels, missing counts, numeric hints, sync truth, review copy, and singular/plural receipt copy were shortened and clarified in both languages.

## Interaction and accessibility checks

- Tested opening a collapsed missing row, filling the numeric phone field, numeric cleanup, auto-advance, partial autosave, background send, known-row confirmation, live progress update, and review navigation.
- The review screen now opens at the top and keeps unanswered students behind progressive disclosure.
- Touch controls remain at least 48px; inputs remain at least 16px to prevent mobile zoom.
- Reduced-motion behavior is still governed by the existing global media query.
- Production browser console: no errors for the verified `localhost:3013` flow.
- Production build, lint, type-check, and all 389 tests passed.

## Comparison history

### Iteration 1 — blocked

- P2: header and introductory guidance consumed too much of the first viewport. Fixed by reducing header type/padding and the guide-strip height.
- P2: the active row used a heavier tinted surface than the selected reference. Fixed by returning the row to the white surface and retaining emphasis through the numbered badge and focused input.
- P2: collapsed missing rows used a second instruction row, increasing scroll effort. Fixed by moving the action to a 48px chevron beside the readable missing-count label.
- P2: the sibling suggestion appeared before the second field and did not match the selected state. Fixed by moving it after the fields and using the same realistic synthetic sibling scenario.
- P2: the initial comparison used a disabled review action while the reference showed acknowledged work. Fixed by exercising a real known-row confirmation and capturing the synchronized state.

### Iteration 2 — passed

- Post-fix evidence: `D:\Codex\scratch\sampark-calm-design-comparison-passed.png`.
- No actionable P0, P1, or P2 differences remain.

## Follow-up polish

- P3: the real bilingual active row is slightly taller than the generated reference because it preserves 48px controls, 16px inputs, full validation hints, and the real sibling action. This is an intentional accessibility and behavior-preservation tradeoff.

## Final result

final result: passed

---

# The console follows the same language (2026-08-11)

Source: the Claude Design project `72d18a0c-8f49-4c0c-823b-7bf7db1ec0a9`,
"Sampark Mobile" — option `1a` is the whole admin console on a 428×908 Android
frame, option `1b` is the teacher form.

The mock introduced **no new colour, font or shadow**. Every value in it was
already a token in `src/styles/tokens.css`. What it contributed was a
systematised, mobile-first application of that language to the console, which
until now was a desktop screen that merely shrank.

## The control vocabulary

`src/components/ui/controls.ts` — class-string helpers, not components,
because four of the things this app styles as buttons are an `<a>`, a `<label>`
wrapping a file input, a `<Link>`, and a `<label>` over a `peer sr-only`
checkbox that has to keep working with JavaScript switched off.

- `btn({shape, tone, full})` — two shapes and four tones, and that is the
  whole set. `action` is the ordinary 48px control; `commit` is the 52px
  full-width button that does the irreversible thing. `primary` is the one
  forward move on a screen, `go` is reserved for sends that leave the app
  (WhatsApp, approving into master), `quiet` is everything else, `danger` is
  bordered and never filled.
- `chip({on, pill})` — `pill` narrows a list you are looking at (36px); the
  default picks something (44px). Selected is a border and a tint, never a
  fill: these appear six at a time.
- `field()`, `eyebrow()`, `card()`, `mono()`, `stepBadge()`.

If a screen needs a sixth shape, decide it there rather than writing a class
string in a 700-line page — that is how 118 separate `rounded-lg border …`
strings and two competing chip idioms got here in the first place.

## Tokens added

`--radius-control` (8px) and `--radius-commit` (10px) join `--radius-card` and
`--radius-chip`; `--color-surface-sunken` and `--color-ink-faint`;
`--shadow-rail`, `--shadow-cta` and `--shadow-badge`, which were four raw
`rgba()` values that had drifted apart (the teacher rail and the console's
action bar lifted content by different amounts on the same phone); and
letter-spacing on the display/title/name sizes, which fifteen h1s were each
applying by hand. `--admin-nav-h` went 52px → 56px.

## Decisions worth not reversing

- **Below md, DataTable is separate cards; at md and up it is still a table.**
  A frame around rows that already have edges is a second border. Requests,
  Students and Audit supply their own phone card through the `card` render-prop
  — a student is a face, a name and a completeness bar, not seven labelled
  values.
- **The phone app bar says where you are, not what the app is called.** A fixed
  strip holding only a wordmark is the most valuable 52px on the screen spent
  on nothing. The back control is a real `<Link>` to the parent section, not
  `history.back()` — the office opens these from WhatsApp, so the previous
  entry is frequently WhatsApp.
- **`/settings` is now an index of six.** With the nav at the bottom and no
  room for a seventh tab, the field registry had no route to it from a phone.
  The sibling cross-links on each settings page are `md`-only, so the same
  navigation is not offered twice.
- **The console's nav icons are Phosphor, not `◉ ✉ ✓ ☰ ⚙`.** Those are ordinary
  characters, so what the office saw was whichever glyph their phone's fallback
  font carried. Icons cross the server/client boundary as a NAME — a component
  reference cannot be serialised as a prop.
- **StatusBoard's 4px left rail is gone.** It repeated the pill beside it in the
  one channel this file's own rule forbids as a sole carrier, and cost 12px on
  a 360px screen where the teacher's name was truncating.
- **The last emoji is gone.** `PhotoField`'s 🙂 is a Phosphor `UserCircle`.

---

# Taps, not pixels (2026-08-15)

A pass over both surfaces judged by one question: does it remove taps, seconds
or hesitation from the five minutes the README budgets? Nothing here changes the
visual language — no new colour, font, shadow or shape.

## The teacher's five minutes

- **The phone box opens the dialpad, not the number row.** `inputMode="tel"`
  rather than `"numeric"`: both suppress letters, but Android draws the first as
  a 3×4 grid whose keys are roughly twice the area. A class of forty-six is 460
  digit taps. Aadhaar is also `tel` in the registry and gets the same pad; marks
  are `number` and keep the row.
- **A numeric box ends itself when no further digit could be legal.**
  `terminal()` in `autosave.ts`. The old rule could only ask "has a fixed-length
  field reached its length", which is a phone number and nothing else — FA marks
  have a maximum and no fixed length, so every one of them needed an explicit
  Enter. Out of 25: after `3`, 30 > 25, finished; after `1`, 10 ≤ 25, wait.
  Only marks 0, 1 and 2 still need the key.
- **Choosing from a select carries the caret on**, for the reason the
  fixed-length advance already did. Two guards, both load-bearing: a native
  select only advances on a POINTER, because arrow-keying a closed `<select>`
  fires `change` on every press and would throw a keyboard user off the field;
  and the type-to-filter box only advances on a `soleMatch` — an exact option
  that nothing on the list extends. The real route list contains both "Agariya"
  and "Agariya Kotari", so this is not hypothetical.
- **"Carry on from there" carries her there.** The restored banner was a
  sentence that did nothing; it is now a button that jumps to `activeStudentId`.
  A button and never an automatic scroll — `focus.ts` already rules that a
  screen scrolling itself while she reads is the screen taking over.
- **The phone box can be emptied in one tap.** The 48px slot held a decorative
  `DeviceMobile` glyph; it now holds a clear button whenever the box has a value
  and the glyph only while it is empty. Replacing a wrong number was ten
  backspaces, against a budget of "forty taps and three corrections". Not
  offered on Aadhaar: twelve digits nobody re-types on a whim.

## One keystroke stops re-rendering the whole class

`StudentRow` is memoised. Everything else in this bullet exists to make that
work, and undoing any of it silently switches it back off:

- the six per-row callbacks come from a `useMemo` map keyed on the roster, not
  from inline arrows rebuilt every render;
- `summarise()` runs only when the review screen is actually open;
- the carry-down map is built only over fields that can carry down, and rounds
  with none share one frozen empty object — which is every phone, Aadhaar and
  marks round;
- `required` falls back to a module-level constant, not a fresh `[]`.

Verified in the browser rather than assumed: after typing into one row, an
untouched row's `memoizedProps` is the *same object reference*, so React bails
out of it entirely. **The state stays in `RequestForm`** — one object to persist,
one place to replay from — and the handlers keep reading `rowsRef.current`,
which is what lets their dependency list be the roster instead of the answers.

Deliberately NOT virtualised: `RequestForm` records that rendering the whole
list was the fix for a real bug, `focus.ts` walks `[data-teacher-input]` across
rows, and the review screen scrolls to `getElementById`. Memoisation gets most
of the win and breaks none of it.

## The console

- **The review queue keeps its promise past the first approve.** "Everything
  actionable is ticked by default" was a `useState` initialiser, which runs
  once; `submit` cleared the selection and refreshed, and nothing re-ticked. So
  from the first approve onwards the office either ticked thirty boxes by hand
  or approved a subset believing it was the lot. It now re-derives when the
  server sends a new list, through the same filter the screen is showing — the
  invariant `narrow()` protects (never tick a row that is not on screen) holds
  across a refresh exactly as it does across a filter change.
- **The status board can be sent.** Build plan §10 calls it the enforcement
  mechanism and asks for the headline in the staff group; it existed only as
  pixels. `buildRoundStatusMessage` puts it in WhatsApp with an empty phone, so
  wa.me opens the contact picker with the body attached. It names GROUPS, not
  teachers — the build plan's own framing, and everyone in a staff group knows
  whose class is whose. A deliberate tap, never a cron.
- **Focus is no longer carried by a 1px border colour.** `btn()` and `chip()`
  had no focus treatment at all and `field()` only swapped a border colour,
  which is colour as sole carrier — the one thing this file forbids everywhere
  else.

  **`outline-solid`, and that is not cosmetic.** Tailwind v4 compiles a width
  utility to `outline-style: var(--tw-outline-style)`, and `outline-none` —
  which `field()` sets to kill the browser ring — compiles to
  `--tw-outline-style: none`. A plain `outline-2` therefore resolves through a
  variable the input has already set to `none`, and the ring is invisible on
  exactly the controls that most need one. This was caught in the browser, not
  in review.

## Verification

`npm run typecheck`, `npm run lint`, `npm test` (504), `npm run build`,
`npm run smoke` (26/26) and `npm run smoke:ui` (46/46) all pass. Every token was
re-confirmed present in the browser's computed `:root`, and each new
`focus-visible` utility confirmed present in the generated stylesheet — Tailwind
v4 pruning has silently dropped values in this repo before.

---

# The board answers "how far has she got" (2026-08-16)

`/requests` was one row per link and said whether it was sent and whether it was
closed. The office's question after a round is who is behind, and a teacher
holding three links was three rows that each knew only about themselves. It now
**opens on a per-teacher board**; `?view=rounds` keeps the old table, which
still owns closing, archiving and bulk work.

## Decisions worth not reversing

- **Marks and details are two counts, never one.** They are different work,
  chased differently and finished at different times; an average describes
  neither. A teacher holding no marks rounds gets no marks count rather than a
  `0/0`.
- **A link carrying both kinds is `mixed`, and is counted once.** Coverage is
  computed per student across a request's whole field set, so such a link has a
  single number covering both halves. Counting it into both buckets would double
  the denominator; picking one would hide the other. It gets its own word.
- **"Not sent" is its own state, ahead of "not started".** Both read `0 of 24`.
  Only one of them is the teacher's doing, and saying "not started" about a link
  the office never handed over is an accusation the data does not support.
- **Overdue is computed over UNFINISHED forms only.** A link she finished last
  week is not something anyone is late on, and letting it set the flag sorted
  her to the top of a chase list she had no business being on.
- **One Remind per person, never per link** — `lib/reminders.ts` is a whole file
  written to remove the per-row button, and this screen shows *more* rows per
  teacher than the one that had it.
- **The list is one shared component.** `TeacherProgressList` renders on both
  the dashboard and `/requests`. Two renderings of "who is behind" drift, and
  the drift is invisible until somebody has both tabs open.
- **`StatusBoard` is no longer a client component.** It never needed to be:
  nothing in it holds state, and both its buttons are real links.

## Four numbers that were wrong

- **The teacher's page and the office disagreed about the same request.**
  `auth/token.ts` counted `distinct student_id` — any submission at all — while
  the board counted students answered for on *every* field. Her page said
  `46 / 46 · पूरा हो गया` in green while `/requests` said 40 of 46 and somebody
  was chasing her for six she believed she had sent. Both now read from
  `lib/answered.ts`, verified on the fixture: `{0/24, 4/21, 2/21}` on both.
- **The marks board grew a phantom row on every subject round.** `askedFor`
  keyed its lines on `requests.audience_label`, which for a subject round is
  "Economics — Prakash Bunkar", while the arriving marks key on the child's real
  class — so the two keys never met. A subject teacher who had entered nothing
  produced *only* the phantom: "not started", no denominator, no way to see she
  owed eighty-six children. It now emits one line per class the frozen roster
  covers, from `classesByRequest`.
  **The denominator was NOT changed** — `marks.ts` documents on purpose that it
  is the live class roll, because a child admitted after the link went out is
  missing a mark just the same. The bug was the key.
- **Five copies of "is this finished".** Now `isAnsweredFully`, in
  `lib/answered.ts` — which is its own file because `lib/requests.ts` already
  imports `generateToken` from `auth/token.ts`, so the rule could not live there
  without a cycle.
- **`request_progress` is dropped.** Dead since it was written, and wrong on
  both numbers it existed to supply. The note in `grants.sql` records why plan
  §4.3 is not being followed.

## Known and deliberately not fixed

- **Two teachers splitting one class for one subject** each get the whole class
  as a denominator. Only the frozen roster could fix it, and that costs the
  documented "admitted later still counts as missing" property.
- **`today` is UTC on the boards and `Asia/Kolkata` for the teacher.** For 5½
  hours each night "past due" and her grace window disagree by a day.
  Pre-existing; `TeacherProgressList` takes `today` as a prop so it is one call
  site when someone picks it up.

## Verification

`npm test` (522), typecheck, lint, build, `npm run smoke` (26/26) and
`npm run smoke:ui` (47/47) pass — the round-is-one-row guard now names
`?view=rounds` explicitly, and a new step asserts the by-teacher default,
because otherwise that guard would have gone green against a screen with no rows
on it at all. `npm run db:grants` re-run; no views remain.

## Teacher surface

Unchanged in shape, per the mock. Measurements only: answer buttons 48 → 52px,
"Confirm all" and the review send button to 56px at the card radius, the four
raw shadows onto tokens. Nothing in `RequestForm`'s state, autosave, upload or
review logic was touched, `Bi.tsx`'s two-line English-over-Hindi structure
stands, and every decision recorded above in this file still holds — no per-row
card chrome, suggestion after the fields.

## Verification

`npm run typecheck`, `npm run lint` and `npm test` (404 tests) all pass, and
`npm run build` compiles every route. Every new token was confirmed present in
the browser's computed `:root` — Tailwind v4 prunes theme variables it cannot
see used, which silently dropped the house colours once before.
