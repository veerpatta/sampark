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
