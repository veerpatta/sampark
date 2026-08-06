import Link from "next/link";
import { redirect } from "next/navigation";
import { canApproveIntoMaster, currentUser } from "@/lib/auth/session";
import { IMPORT_COLUMNS } from "@/lib/students-import";
import { ImportWizard } from "./ImportWizard";

export const metadata = { title: "Import students — Sampark" };
export const dynamic = "force-dynamic";

/**
 * Load a PSP export into the master record.
 *
 * IMPORT_COLUMNS is read here on the server and handed down as plain options —
 * the module it lives in imports the database, and nothing that touches the
 * database belongs in a browser bundle.
 */
export default async function StudentImportPage() {
  const session = await currentUser();
  if (!session) redirect("/login");
  if (!canApproveIntoMaster(session.role)) redirect("/students");

  const columns = IMPORT_COLUMNS.map((spec) => ({
    value: spec.column,
    label: spec.label,
  }));

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Import students
          </h1>
          <Link
            href="/students"
            className="text-sm text-[var(--color-brand-600)] hover:underline"
          >
            back to the list
          </Link>
        </div>
        <p className="mt-1 max-w-prose text-sm text-[var(--color-ink-muted)]">
          Rows are matched on Student ID first, then SR number — never on name.
          A blank cell means &ldquo;no change&rdquo;, so an export with only two
          filled columns will only ever touch those two. Nothing is written
          until you confirm the dry run.
        </p>
      </header>

      <ImportWizard columns={columns} />
    </div>
  );
}
