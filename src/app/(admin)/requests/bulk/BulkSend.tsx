"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Template } from "@/lib/templates";
import type { RecipientMode } from "@/lib/fanout";
import type { Audience } from "@/lib/students";
import { AddQuestion } from "@/components/admin/AddQuestion";
import { ThumbBar } from "@/components/admin/ThumbBar";
import { Card } from "@/components/admin/Card";
import { btn, FOCUS } from "@/components/ui/controls";
import { SUBJECTS } from "@/lib/subjects";
import { isoDayFrom } from "@/lib/today";
import { preview, send, type BulkRequest } from "./actions";

/**
 * How long the office's own sentence may be.
 *
 * SUMMARY_MAX in lib/whatsapp-templates.ts — what Meta leaves for {{3}} once the
 * template's fixed text is counted. sanitiseParam would truncate silently at
 * send time; capping the box means she sees the limit while she is writing,
 * which is the only moment she can do anything about it.
 */
const NOTE_MAX = 700;

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
  carried,
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
  /**
   * The filter the office arrived with, from the students board.
   *
   * Carried whole rather than turned back into chips, because the board filters
   * on dimensions this screen has no picker for — section, gender, category,
   * village, a search term — and rendering only the three it can draw would
   * quietly widen the send. It is shown as one line with a way to drop it.
   */
  carried: {
    audience: Audience;
    /** Resolved on the server. Never arithmetic in the browser. */
    count: number;
    summary: string;
    gapReason: string | null;
    gapReasonHi: string | null;
  } | null;
}) {
  const router = useRouter();

  const [allActive, setAllActive] = useState(false);
  /** Dropping the carried filter returns this screen to the plain picker. */
  const [keepCarried, setKeepCarried] = useState(true);
  const filter = keepCarried ? carried : null;
  /** An uploaded list of specific children, and the office's line about them. */
  const [listed, setListed] = useState<AskList | null>(null);
  const [note, setNote] = useState("");
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
    pickedRoutes.size > 0 ||
    // Both narrow on their own, and the server's isEmptyAudience agrees. These
    // two conditions are twins and must stay that way: a Preview button
    // disabled on an audience the server would happily resolve is a dead end
    // with no message.
    filter !== null ||
    (listed?.studentIds.length ?? 0) > 0;
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

  /**
   * The line the teacher reads above her list, or null for an ordinary round.
   *
   * The office's own sentence wins over the generated one: if she has taken the
   * trouble to type why, saying "12 children: No photo" underneath it as well
   * would be the screen talking over her. Her sentence has no Hindi half —
   * whatever language she wrote it in is the one it goes out in, which is this
   * app's existing rule for anything she is reading off rather than being told.
   */
  function reasonFor(): { en: string; hi: string } | null {
    const typed = note.trim();
    if (typed) return { en: typed, hi: typed };
    if (listed?.message?.trim()) {
      return { en: listed.message.trim(), hi: listed.message.trim() };
    }
    if (filter?.gapReason) {
      return { en: filter.gapReason, hi: filter.gapReasonHi ?? filter.gapReason };
    }
    return null;
  }

  function request(): BulkRequest {
    /*
     * An uploaded list is the WHOLE audience — the chips and the carried filter
     * are ignored, exactly as audienceWhere on the server ignores them. The
     * office named these children; narrowing her list by a filter she left on
     * the screen from a previous attempt would silently drop some of them.
     */
    const audience: Audience = listed?.studentIds.length
      ? { studentIds: listed.studentIds, notes: listed.notes }
      : {
          ...(filter?.audience ?? {}),
          allActive,
          // Chips ADD to the carried filter's own dimension rather than
          // replacing it, so ticking Class 9 beside a carried "Class 8, no
          // photo" asks about both classes and still only the photo-less.
          classes: [...new Set([...(filter?.audience.classes ?? []), ...pickedClasses])],
          houses: [...new Set([...(filter?.audience.houses ?? []), ...pickedHouses])],
          routes: [...new Set([...(filter?.audience.routes ?? []), ...pickedRoutes])],
        };

    return {
      title: title.trim(),
      audience,
      reason: reasonFor(),
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
        {/*
          A LOADED LIST REPLACES THE PICKER RATHER THAN SITTING ABOVE IT.

          The server treats an explicit list as the whole audience — every
          other dimension is ignored, see audienceWhere — so leaving the class
          chips on screen beside it would offer a choice that does nothing.
        */}
        {listed ? (
          <AskListPanel
            list={listed}
            onClear={() => {
              setListed(null);
              invalidate();
            }}
          />
        ) : (
        <>
        {/*
          THE FILTER SHE ARRIVED WITH, whole, with a way to drop it.

          Not turned back into chips: the board filters on section, gender,
          category, village and a search term, and this screen has pickers for
          none of those. Drawing only the three it can would quietly widen the
          send — which is the failure the whole hop was built to avoid.
        */}
        {/*
          ONE ROW, NOT FOUR. This was 207px of a 740px phone — a title line, a
          summary line, a full-width 48px button and a three-line paragraph —
          sitting between the office and the first thing it has to choose.

          The count is the fact worth the weight, so it keeps the type size and
          the summary joins it on the same line. Dropping the filter is a
          SECONDARY action and had been drawn as the most prominent control on
          the card: it is a text button now, still 44px to hit, but it no
          longer competes with the work.
        */}
        {filter ? (
          <div className="mb-4 rounded-[var(--radius-control)] border border-[var(--color-brand-600)] bg-[var(--color-brand-50)] px-3.5 py-2.5">
            <div className="flex items-start justify-between gap-2">
              {/* TWO LINES, NOT ONE WRAPPED ONE. Joined with a dot they broke
                  mid-phrase at 360px — "…from the board · No" / "photo" — which
                  reads as one sentence that got cut rather than as a count and
                  the filter that produced it. */}
              <div className="min-w-0 py-1">
                <p className="text-sm font-medium">
                  {filter.count.toLocaleString("en-IN")}{" "}
                  {filter.count === 1 ? "child" : "children"} from the board
                </p>
                {filter.summary ? (
                  <p className="mt-0.5 break-words text-[13px] text-[var(--color-ink-muted)]">
                    {filter.summary}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => {
                  setKeepCarried(false);
                  invalidate();
                }}
                className={`-mr-2 flex min-h-[var(--tap-min)] shrink-0 items-center px-2 text-[13px] font-medium text-[var(--color-brand-600)] underline-offset-2 hover:underline ${FOCUS}`}
              >
                Drop
              </button>
            </div>
            {filter.gapReason ? (
              /* The trailing clause is the reasoning, and it is true on every
                 screen — but a phone is not where anyone reads why. It comes
                 back at sm, which is the rule pointer-only copy already
                 follows on the office's own screens. */
              <p className="mt-1 break-words text-[13px] leading-snug text-[var(--color-ink-muted)]">
                Teachers will be told{" "}
                <span className="font-medium text-[var(--color-ink)]">
                  &ldquo;{filter.gapReason}&rdquo;
                </span>
                <span className="hidden sm:inline">
                  {" "}
                  — so a part-register does not read as a broken list.
                </span>
              </p>
            ) : null}
          </div>
        ) : null}

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

        {/*
          FOLDED AWAY, because most rounds are a class or a house and this is
          the one that needs a spreadsheet first. Its own summary is a 48px
          target, like every other disclosure on this surface.
        */}
        <details className="mt-4 border-t border-[var(--color-border)] pt-2">
          <summary className="min-h-[var(--tap-min)] cursor-pointer list-none py-2 text-xs font-medium text-[var(--color-brand-600)]">
            Or ask about a list of specific children ▾
          </summary>
          <AskListUpload
            onLoaded={(next) => {
              setListed(next);
              invalidate();
            }}
          />
        </details>
        </>
        )}
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

        {/*
          THE OFFICE'S OWN SENTENCE, and the one place a round can say something
          no filter could work out — "these numbers are not on WhatsApp".

          It rides in a hole the approved WhatsApp template already has, so
          there is nothing to re-approve; 700 characters is what Meta leaves
          after the fixed text, and the counter appears only near the limit
          rather than nagging from the first keystroke.
        */}
        <label className="mt-4 block">
          <span className="text-xs font-medium text-[var(--color-ink-muted)]">
            Anything else the teacher should know? — optional
          </span>
          <textarea
            value={note}
            onChange={(event) => {
              setNote(event.target.value.slice(0, NOTE_MAX));
              invalidate();
            }}
            rows={2}
            placeholder={
              listed?.message ??
              filter?.gapReason ??
              "These numbers are not on WhatsApp — please send the family's WhatsApp number."
            }
            className="mt-1 w-full rounded-[var(--radius-control)] border border-[var(--color-border)] px-3 py-2 text-sm"
          />
          <span className="mt-1 flex flex-wrap justify-between gap-x-3 text-label text-[var(--color-ink-muted)]">
            <span>
              {note.trim()
                ? "Goes out in her WhatsApp message and sits above her list."
                : reasonFor()
                  ? `Leave it blank and the message will say “${reasonFor()!.en}”.`
                  : "Leave it blank for an ordinary round."}
            </span>
            {note.length > NOTE_MAX - 120 ? (
              <span className="font-mono">
                {NOTE_MAX - note.length} left
              </span>
            ) : null}
          </span>
        </label>
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

/* ======================================================= a list of children */

/**
 * The children an uploaded sheet named, and the ones it did not.
 *
 * `studentIds` is what becomes the audience. Everything else on here exists so
 * the office can see what it is about to send before it sends it.
 */
export type AskList = {
  studentIds: string[];
  notes: Record<string, string>;
  /** The round's own sentence, from the template's Message sheet. */
  message: string | null;
  matched: {
    rowNumber: number;
    studentId: string;
    name: string;
    classLabel: string;
    note: string | null;
  }[];
  unmatched: {
    rowNumber: number;
    id: string | null;
    srNo: string | null;
    name: string | null;
    reason: string;
  }[];
  classLabels: string[];
};

/**
 * Download the template, fill it in, upload it back.
 *
 * The button that works everywhere comes first and is full width and 56px; a
 * phone cannot drag a file onto anything, so there is no drop zone here and no
 * copy advertising one. Same rule BulkPhotoDrop follows.
 */
function AskListUpload({ onLoaded }: { onLoaded: (list: AskList) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/requests/ask-list", {
        method: "POST",
        body,
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Could not read that file.");
        return;
      }
      onLoaded(payload as AskList);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-3">
      <p className="text-[13px] text-[var(--color-ink-muted)]">
        For the children no filter can find — the numbers that are not on
        WhatsApp, the photographs that came out blurred. Each class teacher gets
        a link carrying only her own share of the list.
      </p>

      <div className="grid gap-2 sm:flex sm:flex-wrap">
        <a
          href="/api/export/ask-template.xlsx"
          className={`${btn()} w-full sm:w-auto`}
        >
          Download the template
        </a>
        <label
          className={`${btn({ tone: "primary" })} w-full cursor-pointer justify-center sm:w-auto`}
        >
          {busy ? "Reading…" : "Upload a filled sheet"}
          <input
            type="file"
            accept=".xlsx,.csv"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared so choosing the same file twice after a fix still fires.
              event.target.value = "";
              if (file) void upload(file);
            }}
            className="sr-only"
          />
        </label>
      </div>

      <p className="text-label text-[var(--color-ink-muted)]">
        Matched on Student ID, or SR number when there is no ID. Never on name —
        two children in one school share a name more often than you would think.
      </p>

      {error ? (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] border border-[var(--color-danger)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * What the sheet actually named, with what it did not named out loud.
 *
 * THE ROWS THAT DID NOT MATCH ARE THE POINT. A list of thirty-five that
 * quietly becomes a round of thirty-one is the worst thing this can do: the
 * office believes it asked about everyone, and the four it dropped are the four
 * whose records were already wrong. So they are listed with their row numbers,
 * before the send, exactly as planFanOut states who it could not place.
 */
function AskListPanel({
  list,
  onClear,
}: {
  list: AskList;
  onClear: () => void;
}) {
  const matched = list.matched.length;

  return (
    <div className="space-y-3">
      {/* Same shape as the carried-filter banner above, and for the same
          reason: replacing the sheet is an undo, and it had been drawn as the
          most prominent control on the card. */}
      <div className="rounded-[var(--radius-control)] border border-[var(--color-brand-600)] bg-[var(--color-brand-50)] px-3.5 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 py-1">
            <p className="text-sm font-medium">
              {matched.toLocaleString("en-IN")}{" "}
              {matched === 1 ? "child" : "children"} from your sheet
            </p>
            <p className="mt-0.5 break-words text-[13px] text-[var(--color-ink-muted)]">
              {list.classLabels.length === 1
                ? list.classLabels[0]
                : `across ${list.classLabels.length} classes`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClear}
            className={`-mr-2 flex min-h-[var(--tap-min)] shrink-0 items-center px-2 text-[13px] font-medium text-[var(--color-brand-600)] underline-offset-2 hover:underline ${FOCUS}`}
          >
            Replace
          </button>
        </div>
        {list.message ? (
          <p className="mt-1 break-words text-[13px] leading-snug text-[var(--color-ink-muted)]">
            Teachers will be told{" "}
            <span className="font-medium text-[var(--color-ink)]">
              &ldquo;{list.message}&rdquo;
            </span>
          </p>
        ) : null}
      </div>

      {list.unmatched.length > 0 ? (
        <div className="rounded-[var(--radius-control)] border border-[var(--color-warning)] bg-[var(--color-partial-bg)] p-3.5">
          <p className="text-sm font-medium">
            {list.unmatched.length}{" "}
            {list.unmatched.length === 1 ? "row was" : "rows were"} not matched
            and will not be asked about
          </p>
          {/*
            FOUR, THEN A DISCLOSURE — and every row number still reachable.

            One card per row rather than a run of bare lines, because each
            carries the row number the office types into Excel to fix it. But
            five of them is 310px on a 360px phone and the cap was twelve,
            which is 750px: a whole screen of failures burying the form they
            are attached to. The count above is the fact that decides whether
            to go on; the rows are the detail, and detail on a phone belongs
            behind a summary — the same argument the bus-route chips make.
          */}
          <MissList rows={list.unmatched.slice(0, 4)} />
          {list.unmatched.length > 4 ? (
            <details className="mt-1.5">
              <summary className={`flex min-h-[var(--tap-min)] cursor-pointer list-none items-center text-[13px] font-medium text-[var(--color-brand-600)] ${FOCUS}`}>
                Show the other {list.unmatched.length - 4} ▾
              </summary>
              <MissList rows={list.unmatched.slice(4)} />
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The rows a sheet named that could not be honoured, one card each. */
function MissList({
  rows,
}: {
  rows: {
    rowNumber: number;
    id: string | null;
    srNo: string | null;
    name: string | null;
    reason: string;
  }[];
}) {
  return (
    <ul className="mt-2.5 space-y-1.5">
      {rows.map((miss) => (
        <li
          key={miss.rowNumber}
          className="rounded-[var(--radius-control)] bg-[var(--color-surface)] px-3 py-2 text-[13px]"
        >
          <span className="font-mono text-xs text-[var(--color-ink-muted)]">
            Row {miss.rowNumber}
          </span>
          {miss.name ? <span className="ml-2">{miss.name}</span> : null}
          <span className="mt-0.5 block break-words text-[var(--color-ink-muted)]">
            {miss.reason}
          </span>
        </li>
      ))}
    </ul>
  );
}
