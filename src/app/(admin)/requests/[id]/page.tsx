import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  classesByRequest,
  getRequestDetail,
  listNonResponders,
} from "@/lib/requests";
import {
  buildReminderMessage,
  buildRequestMessage,
  buildWhatsAppLink,
} from "@/lib/whatsapp";
import { PageHeader } from "@/components/admin/PageHeader";
import { Card } from "@/components/admin/Card";
import { btn } from "@/components/ui/controls";
import { SharePanel } from "./SharePanel";
import { StatusControls } from "./StatusControls";
import { RemoveControls } from "./RemoveControls";

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
  const [detail, waiting, origin, classes] = await Promise.all([
    getRequestDetail(id),
    listNonResponders(id),
    baseUrl(),
    // Which registers this link actually covers. A subject link merges a
    // teacher's classes into one screen, and the message has to say so.
    classesByRequest([id]),
  ]);
  if (!detail) notFound();

  const { request, teacher, fields, rosterSize, submissionCount } = detail;
  const url = `${origin}/r/${request.token}`;

  // Once she has started, nagging her with the original "please fill this in"
  // reads as if the office has not noticed her work. Switch to the nudge.
  const started = waiting.length < rosterSize;
  const message = (started ? buildReminderMessage : buildRequestMessage)({
    teacherName: teacher.name,
    audience: {
      kind: request.audienceKind,
      label: request.audienceLabel,
      fieldKeys: request.fieldKeys,
      classLabels: classes.get(id) ?? [],
    },
    title: request.title,
    dueDate: request.dueDate,
    url,
  });

  return (
    <div className="space-y-5 md:space-y-8">
      {/* No "back to the board" link: the app bar carries a back chevron on a
          phone and the nav is one tap away at every width. */}
      <PageHeader
        size="detail"
        title={request.title}
        subtitle={`${request.audienceLabel} · ${teacher.name} · due ${request.dueDate}`}
        actions={
          <span className="hidden items-center gap-3 md:inline-flex">
            {/* This link is one group of a send-to-many. The round is where its
                siblings, its send queue and its export live, and the board only
                shows the round now — so without this the way back is a guess. */}
            {request.batchId ? (
              <Link
                href={`/requests/batch/${request.batchId}`}
                className="text-sm text-[var(--color-brand-600)] hover:underline"
              >
                back to the round
              </Link>
            ) : null}
            <Link
              href="/requests"
              className="text-sm text-[var(--color-brand-600)] hover:underline"
            >
              back to the board
            </Link>
          </span>
        }
      />

      <div className="grid gap-5 md:gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card title="What was frozen">
          <dl className="space-y-3 text-sm">
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
                  <ul className="mt-1 text-xs font-normal text-[var(--color-ink-muted)]">
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
              {request.archivedAt ? (
                <span className="ml-2 rounded bg-[var(--color-surface-muted)] px-2 py-0.5 font-mono text-xs text-[var(--color-ink-muted)]">
                  archived
                </span>
              ) : null}
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

          {/* Closed only. Removing a live link would strand a teacher holding a
              URL that has quietly started 404ing, with nobody able to say why. */}
          {request.status === "closed" ? (
            <div className="mt-4 border-t border-[var(--color-border)] pt-4">
              <RemoveControls
                requestId={request.id}
                audienceLabel={request.audienceLabel}
                submissionCount={submissionCount}
                archived={request.archivedAt !== null}
              />
            </div>
          ) : null}

          <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
            The roster and its prefilled values were frozen when this request was
            created and are never recalculated. If a phone number changes in the
            master record now, the review screen will still show what the teacher
            actually saw.
          </p>
        </Card>

        <div className="space-y-5 md:space-y-8">
          {/* contactPhone is set only when the office deliberately overrode
              her saved number for this one request. */}
          <SharePanel
            url={url}
            message={message}
            whatsappUrl={buildWhatsAppLink(
              request.contactPhone ?? teacher.phone,
              message,
            )}
            teacherName={teacher.name}
            sentTo={request.contactPhone ?? teacher.phone}
            overridden={request.contactPhone !== null}
            reminder={started}
          />

          <Card title="Export">
            <a
              href={`/api/export/request/${request.id}.xlsx`}
              className={btn()}
            >
              Download what this collected (.xlsx)
            </a>
            <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
              One row per student, with both the value sent to the teacher and
              the value she gave back, so a correction stays readable later.
            </p>
          </Card>
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
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[10rem_1fr] sm:gap-3">
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
