/**
 * What day it is at the school.
 *
 * THE BUG THIS EXISTS TO FIX. Every board computed today as
 * `new Date().toISOString().slice(0, 10)`, which is the UTC calendar date,
 * while the teacher's own page and the token resolver used Asia/Kolkata. IST is
 * UTC+5:30, so between 18:30 and 24:00 UTC — half past midnight to six in the
 * morning, IST — the two disagreed by a day. In that window the console called
 * a request overdue that the teacher's page still showed as due today, and the
 * grace period the resolver enforced was a day out of step with the "past due"
 * the office was reading. Nobody is at a desk at 2am, but the boards are
 * rendered by whoever opens them and the cron-free reminders are sent by hand
 * the moment somebody notices — which is exactly first thing in the morning.
 *
 * `due_date` is a DATE column: a calendar day with no time and no zone. The
 * only correct thing to compare it against is a calendar day computed in the
 * zone the school actually lives in, which is what this file is.
 *
 * IT HARDCODES THE ZONE, AND NOT BECAUSE NOBODY THOUGHT ABOUT APP_TIMEZONE.
 * That variable is set in .env.example, in the README's table and in the build
 * plan, and is read by nothing — it always has been. Wiring it up here would be
 * worse than leaving it: three of the six callers below are client components,
 * a client cannot read a server-only env var, and the failure mode is not an
 * error but a silent fall back to a different zone on one side of the network.
 * A constant that is the same on both sides cannot do that. If this ever serves
 * a second school in a second zone, the zone belongs on the school record, not
 * in the environment.
 */

/** Asia/Kolkata. One school, one zone, and the same value on both sides. */
export const SCHOOL_TIMEZONE = "Asia/Kolkata";

/**
 * `en-CA` because it formats as YYYY-MM-DD, which is what `due_date` holds and
 * what every comparison in the app does lexically.
 */
const ISO_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: SCHOOL_TIMEZONE,
});

/**
 * The school's calendar date for an instant, as YYYY-MM-DD.
 *
 * Takes the instant rather than reading the clock, so it is a pure function of
 * its argument and the 5½-hour window can be tested rather than waited for.
 */
export function isoDay(at: Date = new Date()): string {
  return ISO_DAY.format(at);
}

/** Today at the school. What every board compares a due date against. */
export function todayISO(now: Date = new Date()): string {
  return isoDay(now);
}

/**
 * The school's calendar date `days` either side of an instant.
 *
 * Negative goes back, which is what the token resolver's grace floor wants.
 * Adding whole days to the millisecond value rather than with `setDate` keeps
 * it independent of the machine's own zone — a server in UTC and a browser in
 * IST both land on the same answer.
 */
export function isoDayFrom(now: Date, days: number): string {
  return isoDay(new Date(now.getTime() + days * 24 * 60 * 60 * 1000));
}
