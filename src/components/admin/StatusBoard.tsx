import Link from "next/link";
import { isAnsweredFully } from "@/lib/answered";
import type { RequestBoardRow } from "@/lib/requests";
import type { TeacherProgress } from "@/lib/progress";
import { buildRoundStatusMessage, buildWhatsAppLink } from "@/lib/whatsapp";
import { btn, card } from "@/components/ui/controls";
import { TeacherProgressList } from "./TeacherProgressList";

/**
 * Who still owes the school something, readable at a glance on a phone.
 *
 * This is the screen the office checks most, and the one that does the actual
 * enforcing — the number shared in the staff group is worth more than ten
 * individual reminders.
 *
 * ONE BLOCK PER TEACHER, NOT PER GROUP, AND THAT IS THE POINT OF THIS FILE.
 * It used to be one row per class with a Remind button on each, so a teacher
 * who takes maths for three classes had three buttons — and pressing them sent
 * her three near-identical WhatsApp messages within a few seconds. From her end
 * that is not three reminders, it is one person spamming her, and the sensible
 * response is to stop reading any of them. The office could not see it happen
 * either, because every row only knew about itself.
 *
 * So the grouping is by person and the nudge is one message carrying everything
 * she owes. Her classes are still listed underneath with their own progress —
 * that detail is why the office comes here — but they are information, not
 * eleven separate things to press.
 *
 * SUBMITTED IS DERIVED, NOT READ. `requests.status` only ever holds open or
 * closed; nothing in the codebase writes "submitted", so trusting that column
 * would render "0 of 11" forever. A class has submitted when every student on
 * its frozen roster has been answered for.
 *
 * EVERY ROW SAYS ITS STATE IN A WORD as well as a colour. This screen gets read
 * on a phone in a corridor between periods, and an office worker who cannot
 * separate the amber from the red still has to know which teacher to chase.
 *
 * THE PER-TEACHER LIST IS NO LONGER HERE. It moved to TeacherProgressList,
 * which /requests renders too — this card was the only place the office could
 * see who was behind, on a page it had to navigate away from to act. What stays
 * is what is genuinely dashboard-shaped: the headline, the thing that sends it,
 * and the roll-call of what is already in.
 *
 * It is also no longer a client component. It never needed to be: nothing here
 * holds state or handles an event, and both buttons are real links.
 */

/**
 * How many teachers the card shows before it defers to the board.
 *
 * They are sorted worst-first, so five is the chase list for this morning. The
 * whole thing is one tap away and does not need to be above the fold twice.
 */
const DASHBOARD_TEACHERS = 5;

export function StatusBoard({
  requests,
  teachers,
  origin,
}: {
  requests: RequestBoardRow[];
  /** Already grouped by the page — it is the one thing here needing a query. */
  teachers: TeacherProgress[];
  /**
   * Handed down from the server, NEVER read off `window` here.
   *
   * This component renders on the server first, where `window` does not exist,
   * so a render-time `window.location.origin` resolves to "" and bakes a
   * relative `/t/abc` into the href — which React then keeps through hydration.
   * The button looks fine and the message it composes carries a path that means
   * nothing once it is in WhatsApp. That was a real bug on this button. See
   * lib/request-origin.ts.
   */
  origin: string;
}) {
  const open = requests.filter((request) => request.status === "open");
  if (open.length === 0) return null;

  const submitted = open.filter(isAnsweredFully);

  /**
   * The headline, as something that can leave the building.
   *
   * Build plan section 10: "The status board is the enforcement mechanism.
   * Share '8 of 11 classes submitted' in the staff group." Until now that
   * sentence existed only as pixels, so sharing it meant a screenshot or
   * retyping it — and the thing the plan calls the enforcement mechanism was
   * the one thing on this screen with no way out of it.
   *
   * An empty phone on purpose, not as a fallback: wa.me with no number opens
   * the contact picker with the body attached, which is exactly right when the
   * destination is a group rather than a person. See lib/share.ts.
   *
   * A REAL LINK AND A DELIBERATE TAP. Never a handler (a real link is never
   * popup-blocked) and never automatic — this names who is behind, and that is
   * the office's call to make each time, not a thing that should ever happen on
   * a schedule.
   */
  const shareHref = buildWhatsAppLink(
    "",
    buildRoundStatusMessage({
      submitted: submitted.length,
      total: open.length,
      outstanding: open
        .filter((request) => !isAnsweredFully(request))
        .map((request) => ({
          label: request.audienceLabel,
          answered: request.studentsAnswered,
          rosterSize: request.rosterSize,
        })),
    }),
  );

  return (
    <section className={`${card()} p-4 md:p-6`}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-title font-semibold">
          {submitted.length} of {open.length}{" "}
          {open.length === 1 ? "group has" : "groups have"} submitted
        </h2>
        <a
          href={shareHref}
          target="_blank"
          rel="noreferrer noopener"
          className={`${btn({ tone: "go" })} shrink-0 px-3 text-[13px]`}
        >
          Share
        </a>
      </div>

      {/* The list itself is shared with /requests — see TeacherProgressList for
          why two renderings of "who is behind" was a drift waiting to happen.
          Five here, because this card sits above the fold on a dashboard and
          the whole board is one tap away. */}
      <div className="mt-3">
        <TeacherProgressList
          teachers={teachers}
          origin={origin}
          limit={DASHBOARD_TEACHERS}
          more={
            <Link
              href="/requests"
              className="text-sm text-[var(--color-brand-600)] hover:underline"
            >
              See all {teachers.length} teachers →
            </Link>
          }
        />
      </div>

      {submitted.length > 0 ? (
        <p className="mt-3 border-t border-[var(--color-border)] pt-3 text-sm text-[var(--color-ink-muted)]">
          Submitted:{" "}
          {submitted.map((request) => request.audienceLabel).join(", ")}
        </p>
      ) : null}
    </section>
  );
}
