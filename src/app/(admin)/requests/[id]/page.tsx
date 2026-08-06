import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getRequestDetail, listNonResponders } from "@/lib/requests";
import {
  buildReminderMessage,
  buildRequestMessage,
  buildWhatsAppLink,
} from "@/lib/whatsapp";
import { SharePanel } from "./SharePanel";
import { StatusControls } from "./StatusControls";

export const metadata = { title: "Request — Sampark" };
export const dynamic = "force-dynamic";

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // None of the three needs an answer from the others — only the id, which we
  // already have. Run them together rather than paying the round trip thrice.
  const [detail, waiting, origin] = await Promise.all([
    getRequestDetail(id),
    listNonResponders(id),
    baseUrl(),
  ]);
  if (!detail) notFound();

  const { request, teacher, fields, rosterSize } = detail;
  const url = `${origin}/r/${request.token}`;

  // Once she has started, nagging her with the original "please fill this in"
  // reads as if the office has not noticed her work. Switch to the nudge.
  const started = waiting.length < rosterSize;
  const message = (started ? buildReminderMessage : buildRequestMessage)({
    teacherName: teacher.name,
    classLabel: request.classLabel,
    title: request.title,
    dueDate: request.dueDate,
    url,
  });

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {request.title}
          </h1>
          <Link
            href="/requests"
            className="text-sm text-[var(--color-brand-600)] hover:underline"
          >
            back to the board
          </Link>
        </div>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          {request.classLabel} · {teacher.name} · due {request.dueDate}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            What was frozen
          </h2>
          <dl className="mt-4 space-y-3 text-sm">
            <Row label="Students in the roster">
              {rosterSize}
              <span className="ml-2 text-xs text-[var(--color-ink-muted)]">
                snapshot taken {formatWhen(request.createdAt)}
              </span>
            </Row>
            <Row label="Still waiting">
              {waiting.length === 0 ? (
                <span className="text-[var(--color-success)]">
                  none — every student answered
                </span>
              ) : (
                <>
                  <span
                    className={
                      started ? "" : "text-[var(--color-warning)]"
                    }
                  >
                    {waiting.length} of {rosterSize}
                  </span>
                  <ul className="mt-1 max-h-40 overflow-auto text-xs font-normal text-[var(--color-ink-muted)]">
                    {waiting.map((student) => (
                      <li key={student.studentId}>
                        {student.rollNo === null ? "" : `${student.rollNo}. `}
                        {student.name}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Row>
            <Row label="Fields asked for">
              <ul className="space-y-0.5">
                {fields.map((field) => (
                  <li key={field.key}>
                    {field.labelEn}{" "}
                    <span lang="hi" className="text-[var(--color-ink-muted)]">
                      {field.labelHi}
                    </span>
                  </li>
                ))}
              </ul>
            </Row>
            {request.period ? (
              <Row label="Period">
                <span className="font-mono text-xs">{request.period}</span>
              </Row>
            ) : null}
            <Row label="Status">
              <span className="rounded bg-[var(--color-surface-muted)] px-2 py-0.5 font-mono text-xs">
                {request.status}
              </span>
            </Row>
          </dl>

          <div className="mt-5 border-t border-[var(--color-border)] pt-4">
            <StatusControls
              requestId={request.id}
              status={request.status}
              answered={rosterSize - waiting.length}
              rosterSize={rosterSize}
            />
          </div>

          <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
            The roster and its prefilled values were frozen when this request was
            created and are never recalculated. If a phone number changes in the
            master record now, the review screen will still show what the teacher
            actually saw.
          </p>
        </section>

        <div className="space-y-6">
          <SharePanel
            url={url}
            message={message}
            whatsappUrl={buildWhatsAppLink(teacher.phone, message)}
            teacherName={teacher.name}
            reminder={started}
          />

          <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Export
            </h2>
            <a
              href={`/api/export/request/${request.id}.xlsx`}
              className="mt-3 inline-block rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-surface-muted)]"
            >
              Download what this collected (.xlsx)
            </a>
            <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
              One row per student, with both the value sent to the teacher and
              the value she gave back, so a correction stays readable later.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3">
      <dt className="text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

/**
 * AUTH_URL is the deployed origin. Falling back to the request host keeps the
 * copied link correct on localhost, where AUTH_URL still points at production.
 */
async function baseUrl(): Promise<string> {
  const list = await headers();
  const host = list.get("host");
  if (host && (host.startsWith("localhost") || host.startsWith("127.0.0.1"))) {
    return `http://${host}`;
  }
  if (process.env.AUTH_URL) return process.env.AUTH_URL.replace(/\/$/, "");
  return host ? `https://${host}` : "";
}

function formatWhen(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(value);
}
