import { redirect } from "next/navigation";
import { canApproveIntoMaster, currentUser } from "@/lib/auth/session";
import { EDIT_SECTIONS, newStudentFields, registryOptions } from "@/lib/student-edit";
import { PageHeader } from "@/components/admin/PageHeader";
import { NewStudentForm } from "./NewStudentForm";

export const metadata = { title: "Add a student — Sampark" };
export const dynamic = "force-dynamic";

/**
 * A child who is not in any file yet.
 *
 * The import wizard is how the school arrives; this is how one child arrives
 * on a Tuesday in September. Same gate as the wizard: owner or admin. The
 * office role, which cannot approve into master, cannot add to it either.
 */
export default async function NewStudentPage() {
  const session = await currentUser();
  if (!session) redirect("/login");
  if (!canApproveIntoMaster(session.role)) redirect("/students");

  // The status section is the one that makes no sense on a new child: a record
  // being created is active.
  const sections = EDIT_SECTIONS.filter((section) => section.key !== "record");
  const fields = newStudentFields(await registryOptions());

  return (
    <div className="space-y-5 md:space-y-8">
      <PageHeader
        title="Add a student"
        subtitle="For a child who is not in the PSP or fee-app files yet. Name and class are required; everything else can come later."
      />
      <NewStudentForm sections={sections} fields={fields} />
    </div>
  );
}
