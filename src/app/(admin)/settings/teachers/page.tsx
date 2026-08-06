import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canManageSettings, currentUser } from "@/lib/auth/session";
import { saveTeacher, setTeacherActive } from "./actions";

export const metadata = { title: "Teachers — Sampark" };
export const dynamic = "force-dynamic";

/**
 * Class teachers and the classes they own.
 *
 * `classes` is what /requests/new offers when you pick a class, so the labels
 * here must match students.class_label exactly — '6', '10 A', '12 Sci'.
 */
export default async function TeachersPage() {
  const session = await currentUser();
  if (!session || !canManageSettings(session.role)) redirect("/");

  const teachers = await db
    .select()
    .from(schema.teachers)
    .orderBy(asc(schema.teachers.name));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Teachers</h1>
        <p className="mt-1 max-w-prose text-sm text-[var(--color-ink-muted)]">
          Phone numbers are 10 digits with no country code — the WhatsApp link
          builder adds 91. Classes are comma separated and must match the
          student records exactly (<code className="font-mono">12 Sci</code>,
          not <code className="font-mono">12 Science</code>).
        </p>
      </header>

      <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
          Add a teacher
        </h2>
        <form action={saveTeacher} className="mt-4 grid gap-3 sm:grid-cols-5">
          <Field name="id" label="ID" placeholder="T01" required />
          <Field name="name" label="Name" required />
          <Field name="phone" label="Phone" placeholder="9XXXXXXXXX" required />
          <Field name="classes" label="Classes" placeholder="6, 7" />
          <div className="flex items-end">
            <input type="hidden" name="active" value="on" />
            <button
              type="submit"
              className="w-full rounded-lg bg-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-700)]"
            >
              Add
            </button>
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {teachers.length === 0 ? (
          <p className="p-6 text-sm text-[var(--color-ink-muted)]">
            No teachers yet. Add the class teachers above — a request cannot be
            created without one.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Classes</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {teachers.map((teacher) => (
                <tr
                  key={teacher.id}
                  className="border-b border-[var(--color-border)] last:border-0"
                >
                  <td className="px-4 py-2 font-mono text-xs">{teacher.id}</td>
                  <td className="px-4 py-2">
                    <form
                      action={saveTeacher}
                      id={`save-${teacher.id}`}
                      className="contents"
                    >
                      <input type="hidden" name="id" value={teacher.id} />
                      <input
                        type="hidden"
                        name="active"
                        value={teacher.active ? "on" : "off"}
                      />
                      <input
                        name="name"
                        defaultValue={teacher.name}
                        className="w-full rounded border border-transparent px-2 py-1 hover:border-[var(--color-border)] focus:border-[var(--color-brand-600)] focus:outline-none"
                      />
                    </form>
                  </td>
                  <td className="px-4 py-2">
                    <input
                      form={`save-${teacher.id}`}
                      name="phone"
                      defaultValue={teacher.phone}
                      className="w-full rounded border border-transparent px-2 py-1 font-mono text-xs hover:border-[var(--color-border)] focus:border-[var(--color-brand-600)] focus:outline-none"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      form={`save-${teacher.id}`}
                      name="classes"
                      defaultValue={teacher.classes.join(", ")}
                      className="w-full rounded border border-transparent px-2 py-1 hover:border-[var(--color-border)] focus:border-[var(--color-brand-600)] focus:outline-none"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        form={`save-${teacher.id}`}
                        type="submit"
                        className="text-xs font-medium text-[var(--color-brand-600)] hover:underline"
                      >
                        Save
                      </button>
                      <form action={setTeacherActive}>
                        <input type="hidden" name="id" value={teacher.id} />
                        <input
                          type="hidden"
                          name="active"
                          value={teacher.active ? "false" : "true"}
                        />
                        <button
                          type="submit"
                          className="text-xs text-[var(--color-ink-muted)] hover:underline"
                        >
                          {teacher.active ? "Deactivate" : "Reactivate"}
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Field({
  name,
  label,
  placeholder,
  required,
}: {
  name: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-[var(--color-ink-muted)]">
        {label}
      </span>
      <input
        name={name}
        placeholder={placeholder}
        required={required}
        className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand-600)]"
      />
    </label>
  );
}
