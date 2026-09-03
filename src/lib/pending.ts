import { compareStudentNames } from "./classes";

/**
 * Who is still missing, and how many of them a message is allowed to name.
 *
 * THE GAP THIS EXISTS TO CLOSE. The reminder could say how many children were
 * left but never which ones — "20 of 24 done", and then the teacher opens the
 * link and hunts for the four cards she skipped. The names were already frozen
 * on the roster and already on screen under "Still waiting"; they had simply
 * never reached the message that asks her to go and fill them in.
 *
 * PURE, AND WITH NO DATABASE IMPORT, for the same reason lib/reminders.ts and
 * lib/send-queue.ts are — and here for a second reason as well. lib/whatsapp.ts
 * is imported by "use client" components, so anything it imports is reachable
 * from the browser bundle. Keeping the type and the caps in a leaf module means
 * that stays true by construction rather than by everyone remembering to write
 * `import type`.
 */

/** One child on a frozen roster who has not been answered for. */
export type PendingStudent = {
  studentId: string;
  rollNo: number | null;
  /** Off the frozen snapshot, never the live master record. */
  name: string;
  /** Also frozen. Only worth showing when the link spans several registers. */
  classLabel: string | null;
};

/**
 * How many children ONE item names before it says "…and N more".
 *
 * A whole class of stragglers is named outright; only a link that spans the
 * school gets cut short.
 */
export const MAX_NAMED_PENDING = 25;

/**
 * Past this the list is not worth carrying at all, and the count is the useful
 * fact.
 *
 * The same reasoning as MAX_NAMED_CLASSES in lib/whatsapp.ts — "beyond a
 * handful, the count is more use than the list" — one order of magnitude up.
 * Twenty-five arbitrary names out of two hundred tells her nothing she can act
 * on, and it is a wall she scrolls past to reach the URL. It also bounds the
 * query in listPendingByRequest: names nobody will read are rows nobody should
 * fetch.
 */
export const NAME_LIST_CEILING = 60;

/**
 * The whole message's budget for names, across every item in it.
 *
 * A per-item cap does not bound a message. A teacher who takes maths for three
 * classes owes three items, and three lists of twenty-five is a seventy-five
 * line wall — which is precisely what one-message-per-person was built to
 * prevent (see lib/reminders.ts). Items are considered oldest-deadline-first,
 * so the thing she is latest on is the thing that gets named.
 */
export const MAX_NAMED_TOTAL = 40;

/**
 * Which children this item may name, or null for "show the count instead".
 *
 * THE BUDGET IS SPENT WHOLE ITEMS AT A TIME, NEVER PART OF ONE, and that rule
 * is the whole reason this is one function rather than two comparisons at the
 * call site. An item costs `min(pending, MAX_NAMED_PENDING)`; if that does not
 * fit in what is left, the item drops to a count and the next one is tried.
 *
 * Spending the budget per NAME instead would quietly reintroduce the case
 * NAME_LIST_CEILING exists to prevent: two items of fifty-five each clear the
 * ceiling, then the first takes twenty-five and the second is left showing
 * fifteen names out of fifty-five — an arbitrary subset, arrived at from the
 * other direction. A partial list is never a state.
 *
 * Three outcomes, decided in this order:
 *   1. more pending than the ceiling      -> null, the count is more use
 *   2. does not fit the remaining budget  -> null, so the message stays readable
 *   3. otherwise                          -> named, truncated at the cap
 */
export function namesFor(
  outstanding: number,
  pending: PendingStudent[] | null,
  budget: number,
  cap = MAX_NAMED_PENDING,
): PendingStudent[] | null {
  if (pending === null || pending.length === 0) return null;
  if (outstanding > NAME_LIST_CEILING) return null;

  const want = Math.min(pending.length, cap);
  if (want > budget) return null;

  return pending.slice(0, want);
}

/**
 * The cap for the OTHER shape — names run together on one wrapped line, which is
 * what a reminder covering several lists uses.
 *
 * MUCH SMALLER THAN MAX_NAMED_PENDING, AND THE DIFFERENCE IS THE POINT. A
 * vertical list of twenty-five is long but scannable: one name per line, roll
 * numbers aligned down the left, checkable against a register. The same
 * twenty-five comma-joined is three hundred and seventy characters of unbroken
 * text — fewer lines than the wall, and less use than the "20 of 45 done" that
 * sits directly above it. Eight is about what reads as a list rather than a
 * paragraph.
 *
 * Past this the inline shape names NOBODY rather than the first eight, for the
 * same reason namesFor spends the budget whole items at a time: a roll-ordered
 * slice of a longer list is still an arbitrary subset, and the progress line
 * already carries the honest version of the fact.
 */
export const MAX_NAMED_INLINE = 8;

/**
 * Register order, which is the order she reads them in.
 *
 * NOT ALPHABETICAL, and that was the earlier answer. This list exists to be
 * checked against a physical register, and a register is in roll order — an
 * alphabetical list of four names means scanning the whole book four times.
 * Children with no roll number fall to the end in name order rather than
 * sorting as zero, which would put them above roll 1.
 */
export function comparePending(a: PendingStudent, b: PendingStudent): number {
  if (a.rollNo !== null && b.rollNo !== null && a.rollNo !== b.rollNo) {
    return a.rollNo - b.rollNo;
  }
  if (a.rollNo === null && b.rollNo !== null) return 1;
  if (a.rollNo !== null && b.rollNo === null) return -1;
  return compareStudentNames(a.name, b.name);
}
