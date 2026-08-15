"use client";

import Link from "next/link";
import type { RequestBoardRow } from "@/lib/requests";
import {
  groupRemindersByTeacher,
  type PendingForm,
  type TeacherReminder,
} from "@/lib/reminders";
import {
  buildRoundReminderMessage,
  buildRoundStatusMessage,
  buildWhatsAppLink,
  teacherPageUrl,
} from "@/lib/whatsapp";
import { btn, card } from "@/components/ui/controls";

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
 */

type Tone = "waiting" | "progress" | "overdue" | "done";

const TONE: Record<Tone, { label: string; pill: string; bar: string }> = {
  waiting: {
    label: "not started",
    pill: "bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]",
    bar: "bg-[var(--color-border)]",
  },
  progress: {
    label: "in progress",
    pill: "bg-[var(--color-correct-bg)] text-[var(--color-correct-fg)]",
    bar: "bg-[var(--color-warning)]",
  },
  overdue: {
    label: "overdue",
    pill: "bg-[var(--color-danger-bg)] text-[var(--color-danger)]",
    bar: "bg-[var(--color-danger)]",
  },
  done: {
    label: "complete",
    pill: "bg-[var(--color-confirm-bg)] text-[var(--color-confirm-fg)]",
    bar: "bg-[var(--color-success)]",
  },
};

const toneOf = (form: PendingForm): Tone =>
  form.overdue ? "overdue" : form.answered > 0 ? "progress" : "waiting";

export function StatusBoard({
  requests,
  origin,
}: {
  requests: RequestBoardRow[];
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
  const today = new Date().toISOString().slice(0, 10);

  const open = requests.filter((request) => request.status === "open");
  if (open.length === 0) return null;

  const done = (request: RequestBoardRow) =>
    request.rosterSize > 0 && request.studentsAnswered >= request.rosterSize;

  const submitted = open.filter(done);
  // groupRemindersByTeacher drops the finished ones, so this is exactly the
  // people someone still has to chase.
  const teachers = groupRemindersByTeacher(open, today);

  /**
   * The nudge, addressed to her, carrying everything she owes.
   *
   * A real link rather than a handler, so the tap goes straight to that
   * teacher's WhatsApp chat. It used to open the OS share sheet, which carries
   * text and no recipient — one tap became "now find Gourisha in your
   * contacts", eleven times down an overdue list.
   */
  function remindHref(teacher: TeacherReminder) {
    return buildWhatsAppLink(
      teacher.phone,
      buildRoundReminderMessage({
        teacherName: teacher.teacherName,
        // Her durable page when she has one: it already carries every form, so
        // sending it instead of N per-request links is the same collapse this
        // component does on screen. Without one, each form brings its own link.
        teacherPageUrl: teacher.linkToken
          ? teacherPageUrl(origin, teacher.linkToken)
          : undefined,
        items: teacher.forms.map((form) => ({
          audience: {
            kind: form.audienceKind,
            label: form.audienceLabel,
            fieldKeys: form.fieldKeys,
          },
          title: form.title,
          dueDate: form.dueDate,
          url: `${origin}/r/${form.token}`,
          answered: form.answered,
          rosterSize: form.rosterSize,
        })),
      }),
    );
  }

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
        .filter((request) => !done(request))
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

      {teachers.length > 0 ? (
        <ul className="mt-3 divide-y divide-[var(--color-border)]">
          {teachers.map((teacher) => (
            <li key={teacher.key} className="py-3 first:pt-0">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{teacher.teacherName}</span>
                  <span className="ml-2 text-sm text-[var(--color-ink-muted)]">
                    {teacher.forms.length === 1
                      ? "1 list"
                      : `${teacher.forms.length} lists`}
                    {teacher.outstanding > 0
                      ? ` · ${teacher.outstanding} to go`
                      : ""}
                  </span>
                  {/* Said out loud, because a nudge going to a covering
                      teacher's phone rather than to hers is exactly the thing
                      the office must not discover afterwards. */}
                  {teacher.overridden ? (
                    <span className="ml-2 rounded-[var(--radius-chip)] bg-[var(--color-surface-muted)] px-2 py-0.5 text-xs text-[var(--color-ink-muted)]">
                      to {teacher.phone}
                    </span>
                  ) : null}
                </div>
                {/* ONE button for the person, whatever she owes. */}
                <a
                  href={remindHref(teacher)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={`${btn()} shrink-0 px-3 text-[13px]`}
                >
                  Remind
                </a>
              </div>

              <ul className="mt-2 space-y-1.5">
                {teacher.forms.map((form) => {
                  const tone = TONE[toneOf(form)];
                  const percent =
                    form.rosterSize === 0
                      ? 0
                      : Math.round((form.answered / form.rosterSize) * 100);
                  return (
                    <li key={form.requestId}>
                      <Link
                        href={`/requests/${form.requestId}`}
                        className="block py-0.5 hover:text-[var(--color-brand-600)]"
                      >
                        <span className="text-sm">{form.audienceLabel}</span>
                        <span
                          className={`ml-2 rounded-[var(--radius-chip)] px-2 py-0.5 text-xs font-medium ${tone.pill}`}
                        >
                          {tone.label}
                        </span>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-sunken)] sm:w-24 sm:flex-none">
                            {/* Takes the row's tone, not a fixed green. A green
                                bar sitting at 40% tells the office the opposite
                                of what the number beside it says. */}
                            <div
                              className={`h-full rounded-full transition-[width] duration-300 ${tone.bar}`}
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                          <span className="shrink-0 font-mono text-xs text-[var(--color-ink-muted)]">
                            {form.answered} of {form.rosterSize}
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-[var(--color-confirm-fg)]">
          Everything open has been answered for.
        </p>
      )}

      {submitted.length > 0 ? (
        <p className="mt-3 border-t border-[var(--color-border)] pt-3 text-sm text-[var(--color-ink-muted)]">
          Submitted:{" "}
          {submitted.map((request) => request.audienceLabel).join(", ")}
        </p>
      ) : null}
    </section>
  );
}
