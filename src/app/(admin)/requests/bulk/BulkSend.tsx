"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Template } from "@/lib/templates";
import type { RecipientMode } from "@/lib/fanout";
import { AddQuestion } from "@/components/admin/AddQuestion";
import { ThumbBar } from "@/components/admin/ThumbBar";
import { Card } from "@/components/admin/Card";
import { btn } from "@/components/ui/controls";
import { SUBJECTS } from "@/lib/subjects";
import { isoDayFrom } from "@/lib/today";
import { preview, send, type BulkRequest } from "./actions";

type Option = { label: string; students: number };
type FieldOption = {
  key: string;
  labelEn: string;
  labelHi: string;
  mode: string;
  needsPeriod: boolean;
};

/**
 * Who, what, to whom, then a preview she has to look at.
 *
 * THE PREVIEW IS A SERVER CALL AND IS NOT OPTIONAL. Only the server can resolve
 * an audience to children, and the number she is shown has to be the number that
 * gets frozen — a count assembled in the browser from chip totals would be a
 * different, plausible, wrong number. Nothing is created until she has seen the
 * list of recipients.
 */
export function BulkSend({
  classes,
  houses,
  routes,
  totalActive,
  anyHouseOwner,
  anyRouteOwner,
  anySubjectTeacher,
  fields,
  templates,
  defaultPeriod,
}: {
  classes: Option[];
  houses: Option[];
  routes: Option[];
  totalActive: number;
  anyHouseOwner: boolean;
  anyRouteOwner: boolean;
  /** Whether teacher_subjects holds anything at all. */
  anySubjectTeacher: boolean;
  fields: FieldOption[];
  templates: Template[];
  defaultPeriod: string;
}) {
  const router = useRouter();

  const [allActive, setAllActive] = useState(false);
  const [pickedClasses, setClasses] = useState<Set<string>>(new Set());
  const [pickedHouses, setHouses] = useState<Set<string>>(new Set());
  const [pickedRoutes, setRoutes] = useState<Set<string>>(new Set());

  const [title, setTitle] = useState("");
  const [fieldKeys, setFieldKeys] = useState<string[]>([]);
  const [period, setPeriod] = useState(defaultPeriod);
  const [dueDate, setDueDate] = useState(plusFiveDays);
  const [mode, setMode] = useState<RecipientMode>("class_teacher");

  const [result, setResult] = useState<Awaited<ReturnType<typeof preview>> | null>(
    null,
  );
  const [overrides, setOverrides] = useState<
    Record<string, { teacherId?: string; contactPhone?: string }>
  >({});
  const [skipBlocked, setSkipBlocked] = useState(false);
  // On by default: the office is filling in a gap in the records, and being
  // asked the same question every round is how the gap stays there.
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsPeriod = fields.some(
    (field) => field.needsPeriod && fieldKeys.includes(field.key),
  );
  const hasAudience =
    allActive ||
    pickedClasses.size > 0 ||
    pickedHouses.size > 0 ||
    pickedRoutes.size > 0;
  const canPreview = hasAudience && fieldKeys.length > 0 && title.trim() !== "";

  // In-charge mode only means something once a house or route is in scope —
  // and only once somebody is actually assigned as one.
  const houseModeOk = pickedHouses.size > 0 && anyHouseOwner;
  const routeModeOk = pickedRoutes.size > 0 && anyRouteOwner;

  // Subject mode routes on the marks fields she ticked, so there is no separate
  // subject picker: the field list IS the picker, and a second one would be a
  // second place to say the same thing and a way for them to disagree.
  const pickedSubjects = SUBJECTS.filter((subject) =>
    fieldKeys.includes(subject.fieldKey),
  );
  const subjectModeOk = pickedSubjects.length > 0 && anySubjectTeacher;

  function request(): BulkRequest {
    return {
      title: title.trim(),
      audience: {
        allActive,
        classes: [...pickedClasses],
        houses: [...pickedHouses],
        routes: [...pickedRoutes],
      },
      fieldKeys,
      period: needsPeriod ? period : null,
      dueDate,
      recipientMode: mode,
      overrides,
      remember,
      skip:
        skipBlocked && result?.ok
          ? result.groups.filter((g) => g.problem).map((g) => g.key)
          : [],
    };
  }

  // Any change to the selection invalidates a preview that is on screen. Leaving
  // a stale one there is how somebody sends eleven links having read the numbers
  // for nine.
  function invalidate() {
    setResult(null);
    setOverrides({});
    setSkipBlocked(false);
    setRemember(true);
  }

  function toggle(
    set: Set<string>,
    update: (next: Set<string>) => void,
    value: string,
  ) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
    invalidate();
  }

  async function runPreview() {
    setBusy(true);
    setError(null);
    const outcome = await preview(request());
    setResult(outcome);
    if (!outcome.ok) setError(outcome.error);
    setBusy(false);
  }

  async function confirmSend() {
    setBusy(true);
    setError(null);
    const outcome = await send(request());
    setBusy(false);

    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    router.push(`/requests/batch/${outcome.batchId}`);
  }

  const blocked = result?.ok ? result.groups.filter((g) => g.problem) : [];
  /** Blocked groups where naming someone corrects the records, not just this send. */
  const gaps = blocked.filter((group) => group.fillsAGap);
  const unresolved = blocked.filter((group) => !overrides[group.key]?.teacherId);
  const sendable = !skipBlocked ? unresolved.length === 0 : true;

  return (
    // Clearance for the ThumbBar. <main> already clears the nav under it.
    <div className="space-y-5 pb-24 md:pb-0">
      {/* ------------------------------------------------------------- who */}
      <Card step={1} title="Who is this about?">
        <Chips
          label="Classes"
          options={classes}
          picked={pickedClasses}
          disabled={allActive}
          onToggle={(value) => toggle(pickedClasses, setClasses, value)}
        />

        <label className="mt-3 flex min-h-[var(--tap-min)] cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border border-[var(--color-border)] px-4">
          <input
            type="checkbox"
            checked={allActive}
            onChange={(event) => {
              setAllActive(event.target.checked);
              invalidate();
            }}
            className="h-4 w-4"
          />
          <span className="text-sm font-medium">
            Every active student
            <span className="ml-2 font-mono text-xs text-[var(--color-ink-muted)]">
              {totalActive}
            </span>
          </span>
        </label>

        <Chips
          label="House"
          options={houses}
          picked={pickedHouses}
          onToggle={(value) => toggle(pickedHouses, setHouses, value)}
        />

        {/* 29 routes unprompted is a wall at 390px, and most sends want none. */}
        <details className="mt-4">
          <summary className="min-h-[var(--tap-min)] cursor-pointer list-none py-2 text-xs font-medium text-[var(--color-brand-600)]">
            Bus route{pickedRoutes.size > 0 ? ` (${pickedRoutes.size})` : ""} ▾
          </summary>
          <Chips
            label=""
            options={routes}
            picked={pickedRoutes}
            onToggle={(value) => toggle(pickedRoutes, setRoutes, value)}
          />
        </details>

        {pickedClasses.size > 0 &&
        (pickedHouses.size > 0 || pickedRoutes.size > 0) ? (
          <p className="mt-3 text-label text-[var(--color-ink-muted)]">
            Both together narrow: children in those classes{" "}
            <strong>and</strong> that house or route.
          </p>
        ) : null}
      </Card>

      {/* ------------------------------------------------------------ what */}
      <Card step={2} title="What are you asking for?">
        <div className="flex flex-wrap gap-2">
          {templates.map((template) => (
            <button
              key={template.name}
              type="button"
              onClick={() => {
                setFieldKeys(template.fieldKeys);
                if (!title.trim()) setTitle(template.name);
                invalidate();
              }}
              className="min-h-[var(--tap-min)] rounded-[var(--radius-control)] border border-dashed border-[var(--color-border)] px-3 text-sm transition-transform active:scale-[0.98]"
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
              className={`flex min-h-[var(--tap-min)] cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border px-3 text-sm ${
                fieldKeys.includes(field.key)
                  ? "border-[var(--color-brand-600)] bg-[var(--color-brand-50)]"
                  : "border-[var(--color-border)]"
              }`}
            >
              <input
                type="checkbox"
                checked={fieldKeys.includes(field.key)}
                onChange={() => {
                  setFieldKeys((current) =>
                    current.includes(field.key)
                      ? current.filter((key) => key !== field.key)
                      : [...current, field.key],
                  );
                  invalidate();
                }}
                className="h-4 w-4"
              />
              <span className="flex-1">{field.labelEn}</span>
              <span lang="hi" className="text-xs text-[var(--color-ink-muted)]">
                {field.labelHi}
              </span>
            </label>
          ))}
        </fieldset>

        <AddQuestion
          onAdded={(key) => {
            setFieldKeys((current) =>
              current.includes(key) ? current : [...current, key],
            );
            invalidate();
          }}
        />

        {needsPeriod ? (
          <label className="mt-4 block max-w-xs">
            <span className="text-xs font-medium text-[var(--color-ink-muted)]">
              Period — marks are stored against it
            </span>
            <input
              value={period}
              onChange={(event) => {
                setPeriod(event.target.value);
                invalidate();
              }}
              className="mt-1 min-h-[var(--tap-min)] w-full rounded-[var(--radius-control)] border border-[var(--color-border)] px-3 text-sm"
            />
          </label>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-[var(--color-ink-muted)]">
              Title — the teacher sees this
            </span>
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                invalidate();
              }}
              placeholder="Mobile number update"
              className="mt-1 min-h-[var(--tap-min)] w-full rounded-[var(--radius-control)] border border-[var(--color-border)] px-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-[var(--color-ink-muted)]">
              Due date
            </span>
            <input
              type="date"
              value={dueDate}
              onChange={(event) => {
                setDueDate(event.target.value);
                invalidate();
              }}
              className="mt-1 min-h-[var(--tap-min)] w-full rounded-[var(--radius-control)] border border-[var(--color-border)] px-3 text-sm"
            />
          </label>
        </div>
      </Card>

      {/* -------------------------------------------------------- send to */}
      <Card step={3} title="Who gets the links?">
        <div className="space-y-2">
          <ModeCard
            picked={mode === "class_teacher"}
            onPick={() => {
              setMode("class_teacher");
              invalidate();
            }}
            title="Class teachers"
            detail="One link per class, each carrying only the children in scope. Nobody is left out — every child has a class."
          />
          <ModeCard
            picked={mode === "house_incharge"}
            onPick={() => {
              setMode("house_incharge");
              invalidate();
            }}
            disabled={!houseModeOk}
            title="House in-charge"
            detail={
              pickedHouses.size === 0
                ? "Pick a house above first."
                : !anyHouseOwner
                  ? "Nobody is set as a house in-charge yet — Settings → Teachers."
                  : "One link per house, carrying children from every class."
            }
          />
          <ModeCard
            picked={mode === "route_incharge"}
            onPick={() => {
              setMode("route_incharge");
              invalidate();
            }}
            disabled={!routeModeOk}
            title="Bus route in-charge"
            detail={
              pickedRoutes.size === 0
                ? "Pick a bus route above first."
                : !anyRouteOwner
                  ? "Nobody is set as a route in-charge yet — Settings → Teachers."
                  : "One link per route, carrying children from every class."
            }
          />
          <ModeCard
            picked={mode === "subject_teacher"}
            onPick={() => {
              setMode("subject_teacher");
              invalidate();
            }}
            disabled={!subjectModeOk}
            title="Subject teachers"
            detail={
              !anySubjectTeacher
                ? "No subject assignments yet — Settings → Subjects."
                : pickedSubjects.length === 0
                  ? "Tick a marks field above, and each goes to whoever teaches it."
                  : `One link per teacher per subject, carrying only her own classes. ${pickedSubjects
                      .map((s) => s.en)
                      .join(", ")}.`
            }
          />
        </div>
        {mode === "subject_teacher" && pickedSubjects.length > 1 ? (
          // Sixteen subjects at once is thirty-eight links and thirty-eight
          // WhatsApp handovers, and a teacher who takes three of them gets three
          // separate messages. Allowed, but she should have meant it.
          <p className="mt-3 rounded-[var(--radius-control)] border border-[var(--color-correct-border)] bg-[var(--color-correct-bg)] px-3 py-2 text-sm text-[var(--color-correct-fg)]">
            {pickedSubjects.length} subjects at once means a separate link, and a
            separate WhatsApp message, for every teacher of each. One subject per
            send is usually kinder.
          </p>
        ) : null}
      </Card>

      {/* --------------------------------------------------------- preview */}
      {result?.ok ? (
        <Card step={4} title="Check before sending">
          <p className="text-title font-semibold">
            {result.links} {result.links === 1 ? "link" : "links"} ·{" "}
            {result.students}{" "}
            {result.students === 1 ? "child" : "children"}
          </p>
          <p className="mt-1 text-label text-[var(--color-ink-muted)]">
            As of now — the roster is frozen when the links are created.
          </p>

          <ul className="mt-4 space-y-2">
            {result.groups
              .filter((group) => !group.problem)
              .map((group) => (
                <li
                  key={group.key}
                  className="flex items-center gap-3 rounded-[var(--radius-control)] border border-[var(--color-border)] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{group.label}</p>
                    <p className="text-meta text-[var(--color-ink-muted)]">
                      {group.teacherName} · {group.students}{" "}
                      {group.students === 1 ? "child" : "children"}
                    </p>
                  </div>
                </li>
              ))}
          </ul>

          {blocked.length > 0 ? (
            <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--color-warning)] bg-[var(--color-correct-bg)] p-3">
              <p className="text-sm font-semibold text-[var(--color-warning-fg)]">
                {blocked.length}{" "}
                {blocked.length === 1 ? "group needs" : "groups need"} a teacher
              </p>
              <ul className="mt-2 space-y-3">
                {blocked.map((group) => (
                  <li key={group.key}>
                    <p className="text-sm font-medium">{group.label}</p>
                    <p className="text-meta text-[var(--color-ink-muted)]">
                      {group.problem}
                    </p>
                    {/* ALWAYS a picker. This used to render only when the
                        group already had owners to choose between — so the one
                        case that most needs answering, "nobody is down for
                        this", showed the problem and no way to act on it. */}
                    <select
                      value={overrides[group.key]?.teacherId ?? ""}
                      onChange={(event) =>
                        setOverrides((current) => ({
                          ...current,
                          [group.key]: { teacherId: event.target.value },
                        }))
                      }
                      className="mt-1 min-h-[var(--tap-min)] w-full rounded-[var(--radius-control)] border border-[var(--color-border)] px-3 text-sm"
                    >
                      <option value="">Choose a teacher…</option>
                      {group.candidates.length > 0 ? (
                        <optgroup label="Already down for it">
                          {group.candidates.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.name}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      <optgroup
                        label={
                          group.candidates.length > 0 ? "Everyone else" : "Teachers"
                        }
                      >
                        {result.teachers
                          .filter(
                            (teacher) =>
                              !group.candidates.some((c) => c.id === teacher.id),
                          )
                          .map((teacher) => (
                            <option key={teacher.id} value={teacher.id}>
                              {teacher.name}
                            </option>
                          ))}
                      </optgroup>
                    </select>
                  </li>
                ))}
              </ul>

              {/* Only offered when at least one group is a genuine gap. Picking
                  between two people who both teach a subject is a decision
                  about this round, not a correction to the records. */}
              {gaps.length > 0 ? (
                <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0"
                  />
                  <span>
                    Remember {gaps.length === 1 ? "this" : "these"} for next time
                    <span className="block text-meta text-[var(--color-ink-muted)]">
                      Saves who teaches what, so the next round already knows.
                      Untick if you are only covering this once.
                    </span>
                  </span>
                </label>
              ) : null}

              <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={skipBlocked}
                  onChange={(event) => setSkipBlocked(event.target.checked)}
                  className="h-5 w-5"
                />
                Send without {blocked.length === 1 ? "it" : "them"}
              </label>
            </div>
          ) : null}

          {result.unassigned ? (
            <p className="mt-4 rounded-[var(--radius-control)] border border-[var(--color-danger)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
              {result.unassigned.count}{" "}
              {result.unassigned.count === 1 ? "child has" : "children have"}{" "}
              {result.unassigned.reason} and will not receive this —{" "}
              {result.unassigned.sample.join(", ")}
              {result.unassigned.count > result.unassigned.sample.length
                ? ", and others"
                : ""}
              .
            </p>
          ) : null}
        </Card>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] border border-[var(--color-danger)] bg-[var(--color-danger-bg)] px-4 py-3 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      {/* The bar is where the thumb is. Same reasoning as the teacher's rail. */}
      <ThumbBar>
        {result?.ok ? (
          <button
            type="button"
            onClick={() => void confirmSend()}
            disabled={busy || !sendable || result.links === 0}
            className={btn({ shape: "commit", tone: "go", full: true })}
          >
            {busy
              ? "Creating…"
              : !sendable
                ? "Choose a teacher for every group first"
                : `Create ${result.links} ${result.links === 1 ? "link" : "links"}`}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void runPreview()}
            disabled={busy || !canPreview}
            className={btn({ shape: "commit", tone: "primary", full: true })}
          >
            {busy
              ? "Working it out…"
              : !hasAudience
                ? "Pick who this is about"
                : fieldKeys.length === 0
                  ? "Pick what to ask"
                  : !title.trim()
                    ? "Give it a title"
                    : "Check it"}
          </button>
        )}
      </ThumbBar>
    </div>
  );
}

function Chips({
  label,
  options,
  picked,
  disabled,
  onToggle,
}: {
  label: string;
  options: Option[];
  picked: Set<string>;
  disabled?: boolean;
  onToggle: (value: string) => void;
}) {
  return (
    <div className={label ? "mt-4" : "mt-2"}>
      {label ? (
        <p className="text-xs font-medium text-[var(--color-ink-muted)]">
          {label}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            disabled={disabled || option.students === 0}
            title={
              option.students === 0 ? "No active students here" : undefined
            }
            onClick={() => onToggle(option.label)}
            className={`min-h-[var(--tap-min)] rounded-[var(--radius-control)] border px-4 text-sm font-medium transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${
              picked.has(option.label)
                ? "border-[var(--color-brand-600)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
                : "border-[var(--color-border)]"
            }`}
          >
            {option.label}
            <span className="ml-2 font-mono text-xs text-[var(--color-ink-muted)]">
              {option.students}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ModeCard({
  picked,
  onPick,
  disabled,
  title,
  detail,
}: {
  picked: boolean;
  onPick: () => void;
  disabled?: boolean;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      className={`w-full rounded-[var(--radius-control)] border p-3 text-left transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 ${
        picked && !disabled
          ? "border-[var(--color-brand-600)] bg-[var(--color-brand-50)]"
          : "border-[var(--color-border)]"
      }`}
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-0.5 text-label text-[var(--color-ink-muted)]">{detail}</p>
    </button>
  );
}


/** Five days out, in the school's zone. See lib/today.ts. */
function plusFiveDays(): string {
  return isoDayFrom(new Date(), 5);
}
