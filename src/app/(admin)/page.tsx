import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { listRequests } from "@/lib/requests";
import { countByClass } from "@/lib/students";
import { CLASS_LABELS } from "@/lib/classes";
import { TEMPLATES } from "@/lib/templates";
import { QuickSend } from "@/components/admin/QuickSend";
import { StatusBoard } from "@/components/admin/StatusBoard";

export const dynamic = "force-dynamic";

/**
 * What the office needs standing in a corridor: send a link, and see who has
 * not sent one back. The counts come after both, because they are context
 * rather than work.
 */
export default async function DashboardPage() {
  const today = new Date().toISOString().slice(0, 10);

  const [requests, [students], counts, teachers] = await Promise.all([
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
  ]);

  const open = requests.filter((request) => request.status === "open");
  const overdue = open.filter((request) => request.dueDate < today);
  const toReview = requests.reduce(
    (total, request) => total + request.changesPending,
    0,
  );

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-display font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Shri Veer Patta Senior Secondary School, Amet
        </p>
      </header>

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

      <StatusBoard requests={requests} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      {overdue.length > 0 ? (
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Past their due date
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {overdue.map((request) => (
              <li key={request.id} className="flex items-baseline gap-3">
                <Link
                  href={`/requests/${request.id}`}
                  className="font-medium text-[var(--color-brand-600)] hover:underline"
                >
                  {request.title}
                </Link>
                <span className="text-[var(--color-ink-muted)]">
                  {request.classLabel} · {request.teacher} · was due{" "}
                  {request.dueDate}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {students?.total === 0 ? (
        <section className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm">
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
      className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card p-5 hover:border-[var(--color-brand-600)]"
    >
      <div className={`text-3xl font-semibold ${colour}`}>
        {value.toLocaleString("en-IN")}
      </div>
      <div className="mt-1 text-sm text-[var(--color-ink-muted)]">{label}</div>
    </Link>
  );
}
