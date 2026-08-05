"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Template } from "@/lib/templates";

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
}: {
  classes: string[];
  teachers: TeacherOption[];
  fields: FieldOption[];
  templates: Template[];
  defaultPeriod: string;
}) {
  const router = useRouter();

  const [classLabel, setClassLabel] = useState("");
  const [fieldKeys, setFieldKeys] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate());
  const [period, setPeriod] = useState(defaultPeriod);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chosen = fields.filter((field) => fieldKeys.includes(field.key));
  const needsPeriod = chosen.some((field) => field.needsPeriod);

  // A teacher who owns the class comes first, but the list is not restricted to
  // them — classes get covered by whoever is available.
  const owners = teachers.filter((teacher) => teacher.classes.includes(classLabel));
  const others = teachers.filter((teacher) => !teacher.classes.includes(classLabel));

  const ready =
    classLabel && fieldKeys.length > 0 && title.trim() && teacherId && dueDate;

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

  if (classes.length === 0) {
    return (
      <Empty>
        No students loaded yet, so there are no classes to pick from. Import a
        PSP export first.
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
          {classes.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                setClassLabel(label);
                setTeacherId("");
              }}
              className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                classLabel === label
                  ? "border-[var(--color-brand-600)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
                  : "border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              {label}
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
              onChange={(event) => setTeacherId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
            >
              <option value="">Choose…</option>
              {owners.length > 0 ? (
                <optgroup label={`Class ${classLabel} teachers`}>
                  {owners.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label="Everyone else">
                {others.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.name}
                  </option>
                ))}
              </optgroup>
            </select>
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
    <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
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
