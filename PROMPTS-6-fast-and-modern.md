# Prompt 6 — make it fast, make it feel modern, make it thumb-first

Measured before writing this:

- Vercel functions run in **iad1 (Washington DC)**. Neon is in
  **ap-southeast-1 (Singapore)**. Every query crosses the Pacific twice.
  TTFB on `/login` — a page with no data at all — was 280–600 ms.
- **No `loading.tsx` anywhere.** Every admin navigation blocks on a full server
  round trip with no feedback, which is exactly what "slow and old" feels like.
- **`useTransition` in 2 files, `useOptimistic` in none.** Every action feels
  like a page reload.
- **No animation library.**
- **`toHindiDigits` in 13 places**, including inside form inputs.
- **The class teacher is not auto-selected** — `useState("")`; owners are merely
  sorted to the top of the list.

Paste the block below into Claude Code.

---

```
The app works. Now it has to feel like it works. I have measured the causes and
most of them are not what you would guess from looking at the CSS.

Work in the order below. Part A is most of the win and touches almost no code;
do not start redesigning components before it is done.

=====================================================================
PART A — it is actually slow, and it is not the UI
=====================================================================

A1. THE FUNCTIONS ARE ON THE WRONG SIDE OF THE PLANET.

    Vercel runs this app's functions in iad1 (Washington DC). Neon is in
    ap-southeast-1 (Singapore). Every single query goes Washington → Singapore
    → Washington, about 230 ms of pure distance, and a page that runs three
    sequential queries pays it three times. The users are in Rajasthan, so a
    request travels India → Washington → Singapore → Washington → India.

    Add vercel.json with regions: ["sin1"] to put the functions in Singapore,
    next to the database and one hop from Rajasthan. Verify after deploy with
    the x-vercel-id response header — it must say sin1, not iad1. Measure TTFB
    on /login before and after and tell me both numbers.

    This is the single biggest thing in this prompt. Do it first.

A2. NO PAGE HAS A loading.tsx.

    Every admin navigation shows the old page, frozen, until the server
    responds. Add a loading.tsx for every route segment under (admin), each
    rendering a skeleton shaped like the real content — not a spinner. A
    spinner says "something is happening"; a skeleton says "your table is
    coming and it will have these columns".

A3. QUERIES RUN IN SEQUENCE THAT COULD RUN TOGETHER.

    Audit every server component and route for awaits that do not depend on
    each other and Promise.all them. At 230 ms each — or ~30 ms once A1 lands —
    three sequential queries is three times the latency for no reason.

A4. EVERY MUTATION SHOULD FEEL INSTANT.

    Wrap every server action in useTransition, and use useOptimistic so the UI
    moves the moment she taps. Approving in the review queue, closing a
    request, confirming a row — all of it updates immediately and reconciles
    when the server answers. If the server rejects, roll back and say so.

A5. PREFETCH. Next prefetches <Link> in the viewport already; make sure the
    admin nav and every row link is a real <Link> and not an onClick router
    push, which prefetches nothing.

=====================================================================
PART B — the class teacher should already be filled in
=====================================================================

Creating a request for Class 8 and then hunting for who teaches Class 8 is
work the app should have done. When a class is chosen:

  - auto-select the teacher whose `classes` array contains that class
  - show her phone number next to her name, right there, not on the next screen
  - both stay editable — a dropdown for the teacher, a text field for the phone
  - if exactly one teacher owns the class, select her silently
  - if more than one owns it, select none and say so: "2 teachers are assigned
    to Class 8 — choose one". Do not guess.
  - if none owns it, leave it blank and offer the full list
  - if the selected teacher has no phone, say so inline and let the phone be
    typed for this request without editing her record. The office should never
    have to leave this screen to send a link.

An edited phone applies to this request only. Changing a teacher's saved number
is a separate, deliberate act in settings.

=====================================================================
PART C — Latin digits everywhere. My earlier instruction was wrong.
=====================================================================

I told you to use Devanagari digits throughout. That was wrong and I am
reversing it. Use 0–9 everywhere: counts, progress, the "7 / 10" counter, and
above all anything inside an input.

A phone number is a phone number. Teachers read it off a paper register in
Latin digits, type it in Latin digits, and dial it in Latin digits. Rendering
it as ०१२३ makes it unreadable at exactly the moment accuracy matters.

Keep the Hindi WORDS. It is the digits that go Latin. Delete toHindiDigits and
its 13 call sites rather than leaving a helper nobody should call.

=====================================================================
PART D — the teacher's form: clearer, quicker, and checked before it sends
=====================================================================

D1. A REVIEW STEP BEFORE SUBMIT. This is the important one.

    Right now she taps through 46 rows and sends. One fat-fingered digit goes
    to the office and nobody catches it until a fee reminder bounces.

    Before sending, show a summary screen:
      - "You changed 6" — each one as old → new, tappable to jump back and fix
      - "You confirmed 38" — collapsed to a single line with a count
      - "You marked 2 as not in this class"
      - anything left untouched, called out plainly: "4 students not answered"

    Send is on this screen, not on the list. She should never be able to submit
    without having seen what she is submitting.

D2. ONE THING AT A TIME ON SMALL SCREENS.

    46 cards in a scroll is a wall. Group by the blanks-first split that
    already exists, and inside each group paginate in tens with a clear "Next
    10". A teacher who can see the end of a batch finishes the batch.

D3. THE KEYBOARD SHOULD NEVER FIGHT HER.

    - inputMode="numeric" and autoComplete="off" on phone and Aadhaar
    - strip non-digits on input rather than erroring afterwards
    - accept a pasted +91 or leading 0 and quietly drop it
    - "7 / 10" as she types; no red until 10 digits or blur
    - auto-advance to the next field when a fixed-length field fills
    - a sticky action bar above the keyboard so "हो गया" is never hidden

D4. UNDO, NOT CONFIRM DIALOGS. Every destructive-feeling action gets a toast
    with an undo for a few seconds. Never a modal asking "are you sure" — a
    modal is a question she cannot answer and will guess at.

=====================================================================
PART E — motion that explains, not motion that decorates
=====================================================================

Add `motion` (the framer-motion successor) — it is small, and hand-rolled CSS
transitions across this many states will rot.

Every animation must answer a question she is already asking:

  - "did my tap register?"    → the row scales down 2% on press and springs
                                back, colour crossfades to the confirmed state
                                over ~200 ms. Add navigator.vibrate(10) on
                                confirm; on an Android phone that single haptic
                                does more for "this feels modern" than any
                                amount of CSS.
  - "how much is left?"       → the progress bar animates to its new width
                                rather than jumping
  - "where did that row go?"  → when a row leaves the blanks group, animate it
                                out and let the list close the gap
  - "is it saved or sent?"    → two distinct, animated states. Saved-on-phone
                                and sent-to-school must never look alike.
  - "what just happened?"     → toasts slide in from the bottom on mobile,
                                where her thumb is, not the top

Respect prefers-reduced-motion — the globals.css rule already exists, make sure
motion honours it rather than bypassing it.

Do NOT animate: page transitions between admin routes (it delays real work),
anything longer than 300 ms, or anything that moves a tap target while a finger
is travelling toward it.

=====================================================================
PART F — the admin is on a phone too
=====================================================================

I will mostly use this standing in a corridor, on my phone, to fire off a
WhatsApp link. Design the admin for that and let the desktop inherit it.

F1. THE THREE-TAP SEND. From opening the app to WhatsApp being open with the
    message typed should be three taps: class → template → send. Build it as
    the primary path on the dashboard, big touch targets, no typing. Everything
    the request builder currently asks for should have a sensible default —
    teacher from the class, due date five days out, title from the template.

F2. USE THE NATIVE SHARE SHEET. navigator.share() with the Hindi message body
    where supported, falling back to the existing wa.me link. Copy-to-clipboard
    stays as a third option, with the button confirming it copied.

F3. THE STATUS BOARD IS THE THING I CHECK MOST. "8 of 11 classes submitted"
    should be readable at a glance on a phone, with the classes that have not
    submitted first and a one-tap reminder next to each.

F4. Bottom navigation on mobile, not a top bar. Thumbs reach the bottom.
    48px minimum on everything. Tables become cards below the md breakpoint —
    a horizontally scrolling table on a phone is a defeat.

=====================================================================
PART G — how it should look
=====================================================================

Do not import a component library and do not restyle for the sake of it. The
token layer in src/styles/tokens.css is sound; the problem is that the app uses
almost none of its range.

  - Depth from a single soft shadow and a 1px border, not from heavy outlines
  - One accent colour doing real work. The three teacher actions keep their
    green/amber/grey semantics — those carry meaning and must not become
    decoration
  - Generous vertical rhythm. Cramped is what reads as "old"
  - Type scale with genuine contrast between a student name and a field label
  - The house colours from prompt 4 as chips, one of the few places colour is
    allowed to be purely identifying
  - Dark mode only if it costs nothing; nobody asked for it

=====================================================================
Verify
=====================================================================

npx tsc --noEmit, npm test and npm run build all pass. Then tell me:

  - TTFB on /login before and after the region change, and what x-vercel-id says
  - taps from opening the app to WhatsApp being open with a Class 8 link
  - taps for a Class 8 teacher to finish a phone request where every stored
    number is already correct
  - what you did about a class with two assigned teachers
  - anything in Part D or F you did not build

Test on a 390px viewport, not a desktop window made narrow. Show me the teacher
list, the review-before-send screen, and the three-tap send.

Plan first. I want to see the ordering, and I want Part A measured before you
touch a component.
```
