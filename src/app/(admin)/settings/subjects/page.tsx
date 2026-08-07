import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canManageSettings, currentUser } from "@/lib/auth/session";
import { CLASS_LABELS, compareClassLabels } from "@/lib/classes";
import { SUBJECTS } from "@/lib/subjects";
import { saveSubjectClasses } from "./actions";

export const metadata = { title: "Subjects — Sampark" };
export const dynamic = "force-dynamic";

/**
 * Who teaches what, to which class.
 *
 * The timetable importer fills this in once; this page is what keeps it true.
 * A subject changes hands in October and somebody has to be able to say so from
 * a phone, in a corridor, without a developer.
 *
 * ONE DISCLOSURE PER TEACHER, and inside it one row per subject she is down
 * for, plus the full list to add one. Sixteen subjects times twenty teachers is
 * three hundred and twenty checkboxes; opening one teacher at a time is the
 * only version of this that fits on a 390px screen. Same shape as the teacher
 * editor next door, deliberately — it is the same job.
 */
export default async function SubjectsSettingsPage() {
  const session = await currentUser();
  if (!session || !canManageSettings(session.role)) redirect("/");

  const [teachers, assignments] = await Promise.all([
    db
      .select()
      .from(schema.teachers)
      .where(eq(schema.teachers.active, true))
      .orderBy(asc(schema.teachers.name)),
    db.select().from(schema.teacherSubjects),
  ]);

  const byTeacher = new Map<string, Map<string, string[]>>();
  for (const row of assignments) {
    const subjects = byTeacher.get(row.teacherId) ?? new Map<string, string[]>();
    const classes = subjects.get(row.subjectKey) ?? [];
    classes.push(row.classLabel);
    subjects.set(row.subjectKey, classes);
    byTeacher.set(row.teacherId, subjects);
  }

  // The other direction, because "who takes Class 9 Maths" is the question the
  // office actually arrives with, and answering it by opening twenty
  // disclosures is not answering it.
  const bySubject = new Map<string, Map<string, string[]>>();
  for (const row of assignments) {
    const classes = bySubject.get(row.subjectKey) ?? new Map<string, string[]>();
    const names = classes.get(row.classLabel) ?? [];
    const teacher = teachers.find((t) => t.id === row.teacherId);
    if (teacher) names.push(teacher.name);
    classes.set(row.classLabel, names);
    bySubject.set(row.subjectKey, classes);
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-display font-semibold tracking-tight">Subjects</h1>
        <p className="mt-1 max-w-prose text-sm text-[var(--color-ink-muted)]">
          Who teaches what. A marks request sent to subject teachers uses this to
          work out who gets which link — one per teacher per subject, carrying
          only her own classes.
        </p>
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          {assignments.length} assignment{assignments.length === 1 ? "" : "s"} on
          record.{" "}
          <Link
            href="/settings/teachers"
            className="text-[var(--color-brand-600)] hover:underline"
          >
            Classes, houses and routes are next door.
          </Link>
        </p>
      </header>

      {assignments.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-[var(--color-correct-border)] bg-[var(--color-correct-bg)] px-4 py-3 text-sm text-[var(--color-correct-fg)]">
          Nothing here yet. Import the timetable with{" "}
          <code className="font-mono text-xs">npm run subjects:import</code>, or
          add assignments by hand below.
        </p>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
          By teacher
        </h2>
        {teachers.map((teacher) => {
          const mine = byTeacher.get(teacher.id) ?? new Map<string, string[]>();
          const summary = SUBJECTS.filter((s) => mine.has(s.key))
            .map((s) => s.en)
            .join(", ");

          return (
            <details
              key={teacher.id}
              className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card"
            >
              <summary className="flex min-h-[var(--tap-min)] cursor-pointer list-none items-center gap-3 px-4 py-2">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{teacher.name}</span>
                  <span className="ml-2 block truncate text-xs text-[var(--color-ink-muted)] sm:ml-0">
                    {summary || "no subjects yet"}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-xs text-[var(--color-ink-muted)]">
                  {[...mine.values()].reduce((n, list) => n + list.length, 0)}
                </span>
              </summary>

              <div className="space-y-4 border-t border-[var(--color-border)] px-4 py-4">
                {SUBJECTS.map((subject) => (
                  <form
                    key={subject.key}
                    action={saveSubjectClasses}
                    className="border-t border-[var(--color-border)] pt-3 first:border-t-0 first:pt-0"
                  >
                    <input type="hidden" name="teacherId" value={teacher.id} />
                    <input type="hidden" name="subjectKey" value={subject.key} />
                    <ClassChips
                      label={subject.en}
                      hi={subject.hi}
                      selected={mine.get(subject.key) ?? []}
                    />
                    <button
                      type="submit"
                      className="mt-2 min-h-[var(--tap-min)] w-full rounded-lg border border-[var(--color-border)] px-4 text-sm font-medium hover:bg-[var(--color-surface-muted)] md:w-auto"
                    >
                      Save {subject.en}
                    </button>
                  </form>
                ))}
              </div>
            </details>
          );
        })}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
          By subject
        </h2>
        <p className="text-xs text-[var(--color-ink-muted)]">
          Two names against one class is not an error — the office is asked to
          choose when the links are made. No name means that class is not asked
          at all.
        </p>
        {SUBJECTS.filter((subject) => bySubject.has(subject.key)).map((subject) => {
          const classes = bySubject.get(subject.key)!;
          return (
            <div
              key={subject.key}
              className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-card"
            >
              <h3 className="font-medium">
                {subject.en}{" "}
                <span lang="hi" className="text-sm text-[var(--color-ink-muted)]">
                  {subject.hi}
                </span>
              </h3>
              <ul className="mt-2 space-y-1 text-sm">
                {[...classes.keys()]
                  .sort(compareClassLabels)
                  .map((classLabel) => {
                    const names = classes.get(classLabel)!;
                    return (
                      <li key={classLabel} className="flex flex-wrap gap-x-2">
                        <span className="font-mono text-xs text-[var(--color-ink-muted)]">
                          {classLabel}
                        </span>
                        <span
                          className={
                            names.length > 1
                              ? "text-[var(--color-correct-fg)]"
                              : ""
                          }
                        >
                          {names.join(" · ")}
                          {names.length > 1 ? " — two names" : ""}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </div>
          );
        })}
      </section>
    </div>
  );
}

/** One subject's classes, as tappable chips. Mirrors the teacher editor's. */
function ClassChips({
  label,
  hi,
  selected,
}: {
  label: string;
  hi: string;
  selected: string[];
}) {
  const chosen = new Set(selected);
  return (
    <fieldset>
      <legend className="text-xs font-medium">
        {label}{" "}
        <span lang="hi" className="text-[var(--color-ink-muted)]">
          {hi}
        </span>
      </legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {CLASS_LABELS.map((option) => (
          <label key={option} className="cursor-pointer">
            <input
              type="checkbox"
              name="classLabel"
              value={option}
              defaultChecked={chosen.has(option)}
              className="peer sr-only"
            />
            <span className="flex min-h-[var(--tap-min)] items-center rounded-[var(--radius-chip)] border border-[var(--color-border)] px-3 text-sm transition-transform active:scale-[0.98] peer-checked:border-[var(--color-brand-600)] peer-checked:bg-[var(--color-brand-50)] peer-checked:font-medium peer-checked:text-[var(--color-brand-700)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-brand-600)]">
              {option}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
