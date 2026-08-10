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
