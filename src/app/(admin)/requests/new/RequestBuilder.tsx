"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Template } from "@/lib/templates";
import { hasPhone, isCompletePhone, normalisePhone, samePhone } from "@/lib/phone";
import { chooseTeacherForClass, partitionByClass } from "@/lib/teachers";

type FieldOption = {
  key: string;
  labelEn: string;
  labelHi: string;
  mode: string;
  /** true when the answer lands in student_records and so needs a period. */
  needsPeriod: boolean;
};

type TeacherOption = {
  id: string;
  name: string;
  classes: string[];
  phone: string;
};

type ClassOption = {
  label: string;
  /** Active students currently in it. Zero means the class cannot be picked. */
  students: number;
};

/**
 * class -> template or custom fields -> teacher -> due date.
 *
 * Ordered the way the office thinks about it. Picking the class first is what
 * lets the teacher list narrow to the people who actually own that class.
 */
export function RequestBuilder({
  classes,
  teachers,
  fields,
  templates,
  defaultPeriod,
  initialClass = "",
  initialTemplate = "",
}: {
  classes: ClassOption[];
  teachers: TeacherOption[];
  fields: FieldOption[];
  templates: Template[];
  defaultPeriod: string;
  /** Pre-applied when the dashboard's quick send handed over. */
  initialClass?: string;
  initialTemplate?: string;
}) {
  const router = useRouter();

  // Applied once, at first render, from the quick-send handoff. Lazy
  // initialisers rather than an effect: an effect would fight her the moment
  // she changed her mind about either one.
  const handedOverTemplate =
    templates.find((option) => option.name === initialTemplate) ?? null;

  const [classLabel, setClassLabel] = useState(initialClass);
  const [fieldKeys, setFieldKeys] = useState<string[]>(() =>
    handedOverTemplate
      ? handedOverTemplate.fieldKeys.filter((key) =>
          fields.some((field) => field.key === key),
        )
      : [],
  );
  const [title, setTitle] = useState(handedOverTemplate?.name ?? "");
  const [teacherId, setTeacherId] = useState(() => {
    // Same rule as the class picker: exactly one owner is selected silently,
    // and anything else stays blank rather than being guessed.
    const choice = chooseTeacherForClass(teachers, initialClass);
    return choice.kind === "one" ? choice.teacherId : "";
  });
  const [phone, setPhone] = useState(() => {
    const choice = chooseTeacherForClass(teachers, initialClass);
    if (choice.kind !== "one") return "";
    return normalisePhone(
      teachers.find((option) => option.id === choice.teacherId)?.phone,
    );
  });
  /** Once she types a number herself, changing the teacher must not clobber it. */
  const [phoneEdited, setPhoneEdited] = useState(false);
  const [teacherNote, setTeacherNote] = useState<string | null>(() => {
    const choice = chooseTeacherForClass(teachers, initialClass);
    return choice.kind === "one" ? null : initialClass ? choice.message : null;
  });
  const [dueDate, setDueDate] = useState(defaultDueDate());
  const [period, setPeriod] = useState(defaultPeriod);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chosen = fields.filter((field) => fieldKeys.includes(field.key));
  const needsPeriod = chosen.some((field) => field.needsPeriod);

  // A teacher who owns the class comes first, but the list is not restricted to
  // them — classes get covered by whoever is available.
  const { owners, others } = partitionByClass(teachers, classLabel);
  const teacher = teachers.find((option) => option.id === teacherId) ?? null;

  const phoneComplete = isCompletePhone(phone);
  const ready =
    classLabel &&
    fieldKeys.length > 0 &&
    title.trim() &&
    teacherId &&
    dueDate &&
    phoneComplete;

  /**
   * Picking a class decides the teacher and her number in the same breath.
   *
   * Deliberately a handler and not a useEffect on classLabel: an effect would
   * also fire when she overrides the teacher by hand, and quietly put it back.
   */
  function chooseClass(label: string) {
    setClassLabel(label);
    const choice = chooseTeacherForClass(teachers, label);

    if (choice.kind === "one") {
      // Exactly one owner. Select her without saying anything — announcing the
      // obvious is how a screen gets noisy.
      chooseTeacher(choice.teacherId, { keepEditedPhone: false });
      setTeacherNote(null);
      return;
    }

    // Two owners, or none. Select NOBODY and say why. Guessing here sends the
    // link to the wrong person and nothing surfaces it until the due date.
    setTeacherId("");
    setPhone("");
    setPhoneEdited(false);
    setTeacherNote(choice.message);
  }

  function chooseTeacher(
    id: string,
    { keepEditedPhone = true }: { keepEditedPhone?: boolean } = {},
  ) {
    setTeacherId(id);
    const picked = teachers.find((option) => option.id === id);
    if (!keepEditedPhone || !phoneEdited) {
      setPhone(normalisePhone(picked?.phone));
      setPhoneEdited(false);
    }
  }

  function applyTemplate(template: Template) {
    const available = template.fieldKeys.filter((key) =>
      fields.some((field) => field.key === key),
    );
    setFieldKeys(available);
    if (!title.trim()) setTitle(template.name);
  }

  function toggleField(key: string) {
    setFieldKeys((current) =>
      current.includes(key)
        ? current.filter((existing) => existing !== key)
        : [...current, key],
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          classLabel,
          teacherId,
          fieldKeys,
          period: needsPeriod ? period.trim() : null,
          dueDate,
          // Only sent when it differs from her saved number. The server stores
          // null otherwise, so the column means "somebody overrode this".
          contactPhone: samePhone(phone, teacher?.phone) ? null : phone,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Could not create the request.");
        return;
      }
      router.push(`/requests/${payload.id}`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (classes.every((option) => option.students === 0)) {
    return (
      <Empty>
        No students loaded yet, so every class is empty. Import the fee app
        export first.
      </Empty>
    );
  }
  if (teachers.length === 0) {
    return (
      <Empty>
        No active teachers. Add them under Settings → Teachers before creating a
        request.
      </Empty>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Card step="1" title="Which class?">
        <div className="flex flex-wrap gap-2">
          {classes.map((option) => (
            <button
              key={option.label}
              type="button"
              disabled={option.students === 0}
              title={
                option.students === 0
                  ? "No active students in this class — import it first"
                  : undefined
              }
              onClick={() => chooseClass(option.label)}
              className={`rounded-lg border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                classLabel === option.label
                  ? "border-[var(--color-brand-600)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
                  : "border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              {option.label}
              <span className="ml-2 font-mono text-xs text-[var(--color-ink-muted)]">
                {option.students}
              </span>
            </button>
          ))}
        </div>
      </Card>

      <Card step="2" title="What are you asking for?">
        <div className="flex flex-wrap gap-2">
          {templates.map((template) => (
            <button
              key={template.name}
              type="button"
              onClick={() => applyTemplate(template)}
              className="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-muted)]"
            >
              {template.name}
            </button>
          ))}
        </div>

        <fieldset className="mt-4 grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Fields</legend>
          {fields.map((field) => (
            <label
              key={field.key}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                fieldKeys.includes(field.key)
                  ? "border-[var(--color-brand-600)] bg-[var(--color-brand-50)]"
                  : "border-[var(--color-border)]"
              }`}
            >
              <input
                type="checkbox"
                checked={fieldKeys.includes(field.key)}
                onChange={() => toggleField(field.key)}
                className="h-4 w-4"
              />
              <span className="flex-1">{field.labelEn}</span>
              <span lang="hi" className="text-xs text-[var(--color-ink-muted)]">
                {field.labelHi}
              </span>
              {field.mode === "collect" ? (
                <span className="rounded bg-[var(--color-correct-bg)] px-1.5 py-0.5 text-xs text-[var(--color-correct-fg)]">
                  collect
                </span>
              ) : null}
            </label>
          ))}
        </fieldset>

        {needsPeriod ? (
          <label className="mt-4 block max-w-xs">
            <span className="text-xs font-medium text-[var(--color-ink-muted)]">
              Period — marks are stored against it
            </span>
            <input
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              placeholder="2026-27/FA1"
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
            />
          </label>
        ) : null}
      </Card>

      <Card step="3" title="Who is filling it in, and by when?">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-[var(--color-ink-muted)]">
              Title — the teacher sees this
            </span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Mobile number update"
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-[var(--color-ink-muted)]">
              Teacher
            </span>
            <select
              value={teacherId}
              onChange={(event) => {
                chooseTeacher(event.target.value, { keepEditedPhone: false });
                setTeacherNote(null);
              }}
              className="mt-1 min-h-[var(--tap-min)] w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
            >
              <option value="">Choose…</option>
              {owners.length > 0 ? (
                <optgroup label={`${classLabel} teachers`}>
                  {owners.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label="Everyone else">
                {others.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </optgroup>
            </select>
            {teacherNote ? (
              <span className="mt-1 block text-xs font-medium text-[var(--color-warning)]">
                {teacherNote}
              </span>
            ) : null}
          </label>

          {/* Her number, here, not on the next screen. This is what the link
              gets sent to and it is the one thing most likely to be wrong. */}
          <label className="block">
            <span className="text-xs font-medium text-[var(--color-ink-muted)]">
              Her number — this request only
            </span>
            <input
              value={phone}
              onChange={(event) => {
                setPhone(normalisePhone(event.target.value));
                setPhoneEdited(true);
              }}
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              placeholder="10 digits"
              disabled={!teacherId}
              className={`mt-1 min-h-[var(--tap-min)] w-full rounded-lg border px-3 py-2 font-mono text-sm disabled:opacity-50 ${
                phone && !phoneComplete
                  ? "border-[var(--color-danger)]"
                  : "border-[var(--color-border)]"
              }`}
            />
            <span className="mt-1 block text-xs text-[var(--color-ink-muted)]">
              {!teacherId
                ? "Pick a teacher first."
                : !hasPhone(teacher?.phone)
                  ? `No number is saved for ${teacher?.name}. Type one — it is used for this request and her record is left alone.`
                  : phoneEdited && !samePhone(phone, teacher?.phone)
                    ? "This request only. Her saved number is unchanged — change that in Settings → Teachers."
                    : "Her saved number. Edit it here to send this one link somewhere else."}
            </span>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-[var(--color-ink-muted)]">
              Due date
            </span>
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
            />
            <span className="mt-1 block text-xs text-[var(--color-ink-muted)]">
              Keep it short. Five days works; three weeks gets forgotten.
            </span>
          </label>
        </div>
      </Card>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-[var(--color-danger)] bg-red-50 px-4 py-3 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!ready || busy}
          className="rounded-lg bg-[var(--color-brand-600)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-brand-700)] disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create request and get the link"}
        </button>
        <span className="text-xs text-[var(--color-ink-muted)]">
          The class list is frozen at this moment — later changes to master will
          not alter what the teacher sees.
        </span>
      </div>

      {/* The reason to keep collecting, said out loud where the decision is
          made. Every field filled makes every later request easier to answer,
          and that compounding is invisible unless someone points at it. */}
      {classLabel ? (
        <p className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-xs text-[var(--color-ink-muted)]">
          <strong className="font-medium text-[var(--color-ink)]">
            Recognition context.
          </strong>{" "}
          Each row will also show whatever else we hold for that child — SR
          number, house as a coloured chip, bus route, father&rsquo;s name — so
          the teacher can be sure which child she is answering for. Fields you
          are asking about are never repeated as context. The more that gets
          collected, the easier every later request is to answer.
        </p>
      ) : null}
    </form>
  );
}

/** Five days out, per the rollout notes. */
function defaultDueDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 5);
  return date.toISOString().slice(0, 10);
}

function Card({
  step,
  title,
  children,
}: {
  step: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card p-6">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-surface-muted)] font-mono text-xs">
          {step}
        </span>
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-ink-muted)]">
      {children}
    </p>
  );
}
