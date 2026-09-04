import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { listRequests, pendingForBoard } from "@/lib/requests";
import { groupProgressByTeacher } from "@/lib/progress";
import { marksFieldKeys } from "@/lib/marks";
import { requestOrigin } from "@/lib/request-origin";
import { isApiConfigured } from "@/lib/aisensy";
import { todayISO } from "@/lib/today";
import { countByClass } from "@/lib/students";
import {
  backfillToday,
  hasSnapshotFor,
  healthByClass,
  toHeatmap,
  trend,
  withToday,
  worstClasses,
} from "@/lib/data-health";
import { recentActivity } from "@/lib/activity";
import { ActivityList } from "@/components/admin/ActivityList";
import { ProgressBar } from "@/components/admin/ProgressBar";
import { Sparkline } from "@/components/admin/Sparkline";
import { CLASS_LABELS } from "@/lib/classes";
import { TEMPLATES } from "@/lib/templates";
import { QuickSend } from "@/components/admin/QuickSend";
import { StatusBoard } from "@/components/admin/StatusBoard";
import { PageHeader } from "@/components/admin/PageHeader";
import { Card } from "@/components/admin/Card";
import { card } from "@/components/ui/controls";

export const dynamic = "force-dynamic";

/**
 * What the office needs standing in a corridor: send a link, and see who has
 * not sent one back. The counts come after both, because they are context
 * rather than work.
 */
export default async function DashboardPage() {
  // The school's calendar date, not the server's. See lib/today.ts.
  const today = todayISO();

  const origin = await requestOrigin();

  const [
    requests,
    [students],
    counts,
    teachers,
    marksKeys,
    health,
    series,
    activity,
    snapshotted,
  ] = await Promise.all([
    listRequests(),
    db
      .select({
        total: sql<number>`count(*)::int`,
        missingPhone: sql<number>`count(*) filter (where phone is null or phone = '')::int`,
      })
      .from(schema.students),
    countByClass(),
    db
      .select()
      .from(schema.teachers)
      .where(eq(schema.teachers.active, true))
      .orderBy(asc(schema.teachers.name)),
    marksFieldKeys(),
    healthByClass(),
    trend(30),
    recentActivity(12),
    hasSnapshotFor(today),
  ]);

  const grid = toHeatmap(health);
  const behind = worstClasses(health, 3, grid);

  // The safety net for a day the cron missed, from the rows just read rather
  // than a second scan — and after the reads, so it never delays the page.
  await backfillToday(snapshotted, health);

  // Grouped here rather than inside the card, because it is the one thing on
  // that card that needs a query — the registry read that says which fields are
  // marks. See lib/progress.ts.
  const progress = groupProgressByTeacher(
    requests.filter((request) => request.status === "open"),
    new Set(marksKeys.keys()),
    today,
    // Who is still missing, so the Remind button can name them. Filtered to the
    // rows a chase would actually name — see pendingForBoard.
    await pendingForBoard(requests),
  );

  const open = requests.filter((request) => request.status === "open");
  const overdue = open.filter((request) => request.dueDate < today);
  const toReview = requests.reduce(
    (total, request) => total + request.changesPending,
    0,
  );

  return (
    <div className="space-y-5 md:space-y-8">
      <PageHeader
        title="Dashboard"
        subtitle="Shri Veer Patta Senior Secondary School, Amet"
      />

      {/* The two things worth doing from a phone, above the numbers. */}
      <QuickSend
        classes={CLASS_LABELS.map((label) => ({
          label,
          students: counts.get(label) ?? 0,
        }))}
        teachers={teachers.map((teacher) => ({
          id: teacher.id,
          name: teacher.name,
          classes: teacher.classes,
          phone: teacher.phone,
        }))}
        templates={TEMPLATES}
      />

      <StatusBoard
        requests={requests}
        teachers={progress}
        origin={origin}
        today={today}
        apiEnabled={isApiConfigured()}
      />

      {/* Two across on a phone, not one. Four counts stacked vertically is a
          screenful of scrolling for four numbers, and the pairs read against
          each other — students against how many have no number, requests open
          against how many are waiting on the office. */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <Stat label="Students on record" value={students?.total ?? 0} href="/students" />
        <Stat
          label="Missing a mobile number"
          value={students?.missingPhone ?? 0}
          tone={students?.missingPhone ? "warning" : "muted"}
          href="/students"
        />
        <Stat label="Open requests" value={open.length} href="/requests" />
        <Stat
          label="Waiting for review"
          value={toReview}
          tone={toReview > 0 ? "pending" : "muted"}
          href="/review"
        />
      </div>

      {overdue.length > 0 || open.length > 0 ? (
        <p className="-mt-4 text-xs text-[var(--color-ink-muted)]">
          {overdue.length > 0
            ? `${overdue.length} of ${open.length} open request${open.length === 1 ? "" : "s"} past due.`
            : `All ${open.length} open request${open.length === 1 ? "" : "s"} still within date.`}
        </p>
      ) : null}

      {/* The two panels that say what is moving: how full the records are
          getting, and what people did lately. After the counts, because they
          are context rather than work — but on the first screen, because
          "is it improving" is the question that keeps the rounds going. */}
      {students?.total ? (
        <div className="grid gap-5 md:gap-6 lg:grid-cols-2">
          <Card
            title="Data health"
            action={
              <Link
                href="/students/health"
                className="inline-flex min-h-[var(--tap-min)] items-center text-sm text-[var(--color-brand-600)] hover:underline md:min-h-0"
              >
                By class and field
              </Link>
            }
          >
            <div className="flex items-end gap-4">
              <span className="text-display font-semibold">{grid.school.percent}%</span>
              <span className="pb-1 text-xs text-[var(--color-ink-muted)]">of tracked fields filled</span>
              <Sparkline
                points={withToday(series, today, grid.school.percent)}
                width={140}
                height={36}
                label="School completeness over the last 30 days"
                className="ml-auto"
              />
            </div>
            {behind.length > 0 ? (
              <ul className="mt-4 space-y-1">
                {behind.map((row) => (
                  <li key={row.classLabel}>
                    {/* The whole row is the link: a 24px-wide class label is
                        not a target a thumb can find. */}
                    <Link
                      href={`/students?class=${encodeURIComponent(row.classLabel)}&sort=complete`}
                      className="flex min-h-[var(--tap-min)] items-center gap-3 rounded-[var(--radius-control)] px-1 text-sm hover:bg-[var(--color-surface-muted)] md:min-h-0 md:py-1.5"
                    >
                      <span className="w-24 shrink-0 font-medium">{row.classLabel}</span>
                      <ProgressBar
                        value={row.filled}
                        max={row.total}
                        label={`${row.classLabel}: ${row.percent}% complete`}
                        tone={
                          row.percent >= 80
                            ? "bg-[var(--color-success)]"
                            : row.percent >= 50
                              ? "bg-[var(--color-warning)]"
                              : "bg-[var(--color-danger)]"
                        }
                        className="h-1.5 flex-1"
                      />
                      <span className="w-10 text-right font-mono text-xs">{row.percent}%</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3 text-xs text-[var(--color-ink-muted)]">The three classes furthest behind.</p>
          </Card>

          <Card title="Recent activity" flush>
            <ActivityList events={activity} />
          </Card>
        </div>
      ) : null}

      {overdue.length > 0 ? (
        <Card title="Past their due date">
          <ul className="space-y-2 text-sm">
            {overdue.map((request) => (
              <li key={request.id} className="flex items-baseline gap-3">
                <Link
                  href={`/requests/${request.id}`}
                  className="font-medium text-[var(--color-brand-600)] hover:underline"
                >
                  {request.title}
                </Link>
                <span className="text-[var(--color-ink-muted)]">
                  {request.audienceLabel} · {request.teacher} · was due{" "}
                  {request.dueDate}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {students?.total === 0 ? (
        <section className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm md:p-6">
          <p className="font-medium">Nothing loaded yet.</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[var(--color-ink-muted)]">
            <li>
              Add the class teachers under{" "}
              <Link href="/settings/teachers" className="text-[var(--color-brand-600)] hover:underline">
                Settings → Teachers
              </Link>
            </li>
            <li>
              <Link href="/students/import" className="text-[var(--color-brand-600)] hover:underline">
                Import a PSP export
              </Link>{" "}
              — one class is enough to try it
            </li>
            <li>
              <Link href="/requests/new" className="text-[var(--color-brand-600)] hover:underline">
                Create a request
              </Link>{" "}
              and open the link on your own phone
            </li>
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  href,
  tone = "muted",
}: {
  label: string;
  value: number;
  href: string;
  tone?: "muted" | "warning" | "danger" | "pending";
}) {
  const colour = {
    muted: "text-[var(--color-ink)]",
    warning: "text-[var(--color-warning)]",
    danger: "text-[var(--color-danger)]",
    pending: "text-[var(--color-pending)]",
  }[tone];

  return (
    <Link
      href={href}
      className={`${card()} p-4 hover:border-[var(--color-brand-600)]`}
    >
      <div className={`text-display font-semibold ${colour}`}>
        {value.toLocaleString("en-IN")}
      </div>
      <div className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
        {label}
      </div>
    </Link>
  );
}
