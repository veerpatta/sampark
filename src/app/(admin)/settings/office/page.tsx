import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canManageSettings, currentUser } from "@/lib/auth/session";
import { getOfficeRecipient, MASTER_AUDIENCE_KIND } from "@/lib/office";
import { requestOrigin } from "@/lib/request-origin";
import { PageHeader } from "@/components/admin/PageHeader";
import { SettingsCrumbs } from "@/components/admin/SettingsCrumbs";
import { Card } from "@/components/admin/Card";
import { OfficeForm } from "./OfficeForm";

export const metadata = { title: "Office — Sampark" };
export const dynamic = "force-dynamic";

/**
 * The office's own number, and every master link currently live.
 *
 * WHY THIS SCREEN EXISTS SEPARATELY FROM THE TEACHER EDITOR. The office is a
 * row in `teachers` because resolveToken needs a recipient to join to
 * (lib/office.ts), but it is not a teacher: it owns no class, receives no
 * reminder, and appears in no picker. Editing it beside nineteen people who are
 * all the other thing would be a row somebody changes by accident.
 *
 * IT IS ALSO THE AUDIT. A master link reaches every group in a round, so "which
 * of these are open right now, and how many children can each one see" is a
 * question somebody should be able to answer without opening the database. The
 * answer is the list below, and closing the round is what kills the link.
 */
export default async function OfficeSettingsPage() {
  const session = await currentUser();
  if (!session || !canManageSettings(session.role)) redirect("/");

  const [office, origin] = await Promise.all([
    getOfficeRecipient(),
    requestOrigin(),
  ]);

  const live = await db
    .select({
      requestId: schema.requests.id,
      title: schema.requests.title,
      token: schema.requests.token,
      dueDate: schema.requests.dueDate,
      createdAt: schema.requests.createdAt,
      rotatedAt: schema.requests.tokenRotatedAt,
      batchId: schema.requests.batchId,
    })
    .from(schema.requests)
    .where(
      and(
        eq(schema.requests.audienceKind, MASTER_AUDIENCE_KIND),
        eq(schema.requests.status, "open"),
      ),
    )
    .orderBy(desc(schema.requests.createdAt));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Office"
        subtitle="Every round mints one master link covering all of its classes, and sends it here. This is the number it goes to."
      />
      <SettingsCrumbs current="/settings/office" />

      <Card title={office ? "The office number" : "Set the office number"}>
        {office ? null : (
          <p className="text-sm text-[var(--color-ink-muted)]">
            Until this is set, rounds are created without a master link. Nothing
            else changes — every teacher still gets her own.
          </p>
        )}
        <OfficeForm office={office} />
      </Card>

      <Card title="Master links open right now">
        <p className="text-sm text-[var(--color-ink-muted)]">
          Each one opens every class in its round, with no login. Closing the
          round closes the link; rotating it from the round&rsquo;s page replaces
          the address and kills the old one immediately.
        </p>

        {live.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--color-ink-muted)]">
            None open.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {live.map((row) => (
              <li
                key={row.requestId}
                className="border-t border-[var(--color-border)] pt-3 first:border-t-0 first:pt-0"
              >
                <p className="text-name font-medium">{row.title}</p>
                <p className="mt-0.5 break-all font-mono text-meta text-[var(--color-ink-muted)]">
                  {origin}/r/{row.token}
                </p>
                <p className="mt-0.5 text-meta text-[var(--color-ink-muted)]">
                  due {row.dueDate}
                  {row.rotatedAt
                    ? ` · rotated ${row.rotatedAt.toISOString().slice(0, 10)}`
                    : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
