import Link from "next/link";
import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canManageSettings, currentUser } from "@/lib/auth/session";
import { STUDENT_COLUMN_BY_DB_NAME } from "@/lib/student-columns";
import { saveField, setFieldActive } from "./actions";

export const metadata = { title: "Field registry — Sampark" };
export const dynamic = "force-dynamic";

/**
 * Owner-only editor for `field_defs`.
 *
 * Rule 11: adding a collectable field is a database row, not a deployment.
 * This page is what makes that true in practice.
 */
export default async function FieldSettingsPage() {
  const session = await currentUser();
  if (!session || !canManageSettings(session.role)) redirect("/");

  const all = await db
    .select()
    .from(schema.fieldDefs)
    .orderBy(asc(schema.fieldDefs.sortOrder), asc(schema.fieldDefs.key));

  // One-off questions the office added while building a request are separated
  // out. They accumulate — one per uniform order, one per trip — and thirty of
  // them interleaved would bury the sixteen fields that actually write to the
  // student record, which is what this screen is for.
  const fields = all.filter((field) => field.recordKind !== "adhoc");
  const questions = all.filter((field) => field.recordKind === "adhoc");

  const columns = [...STUDENT_COLUMN_BY_DB_NAME.keys()].sort();

  return (
    <div className="space-y-8">
      <header>
        <div className="flex items-baseline gap-3">
          <h1 className="text-display font-semibold tracking-tight">
            Field registry
          </h1>
          <Link
            href="/settings/teachers"
            className="text-sm text-[var(--color-brand-600)] hover:underline"
          >
            teachers
          </Link>
          <Link
            href="/settings/users"
            className="text-sm text-[var(--color-brand-600)] hover:underline"
          >
            admin users
          </Link>
          <Link
            href="/settings/audit"
            className="text-sm text-[var(--color-brand-600)] hover:underline"
          >
            audit log
          </Link>
        </div>
        <p className="mt-1 max-w-prose text-sm text-[var(--color-ink-muted)]">
          Adding something new to collect is a row here, not a deployment.{" "}
          <strong>Verify</strong> means the school already holds a value and
          wants it confirmed; <strong>collect</strong> means it holds nothing.
          A field with a target column writes to that column on the student
          record; one without writes a period-scoped record instead, which is
          how marks are stored.
        </p>
      </header>

      <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
          Add or update a field
        </h2>
        <form action={saveField} className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field name="key" label="Key" placeholder="bank_account" required />
          <Field name="labelEn" label="English label" required />
          <Field name="labelHi" label="Hindi label" required lang="hi" />

          <Select name="mode" label="Mode" options={["verify", "collect"]} />
          <Select
            name="inputType"
            label="Input type"
            options={["text", "tel", "date", "number", "select", "boolean"]}
          />
          <Select
            name="targetColumn"
            label="Target column on students"
            options={["", ...columns]}
            labels={{ "": "— none (period-scoped record) —" }}
          />

          <Field name="recordKind" label="Record kind (if no column)" placeholder="fa_marks" />
          <Field name="exactLen" label="Exact length" placeholder="10" />
          <Field name="maxValue" label="Max value" placeholder="25" />

          <Field
            name="options"
            label="Options (comma separated, for select)"
            placeholder="GEN, OBC, SC, ST, EWS"
          />
          <Field name="sortOrder" label="Sort order" placeholder="100" />

          <div className="flex items-end gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked className="h-4 w-4" />
              Active
            </label>
            <button
              type="submit"
              className="ml-auto rounded-lg bg-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-700)]"
            >
              Save
            </button>
          </div>
        </form>
      </section>

      {/* Seven columns of reference, read a few times a year at a desk. It
          scrolls sideways on a phone rather than being rebuilt as cards. */}
      <section className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">
            <tr>
              <th className="px-4 py-3">Key</th>
              <th className="px-4 py-3">Label</th>
              <th className="px-4 py-3">Mode</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Writes to</th>
              <th className="px-4 py-3">Rule</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr
                key={field.key}
                className={`border-b border-[var(--color-border)] last:border-0 ${
                  field.active ? "" : "opacity-50"
                }`}
              >
                <td className="px-4 py-2 font-mono text-xs">{field.key}</td>
                <td className="px-4 py-2">
                  {field.labelEn}
                  <span lang="hi" className="ml-2 text-[var(--color-ink-muted)]">
                    {field.labelHi}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      field.mode === "collect"
                        ? "bg-[var(--color-correct-bg)] text-[var(--color-correct-fg)]"
                        : "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
                    }`}
                  >
                    {field.mode}
                  </span>
                </td>
                <td className="px-4 py-2 font-mono text-xs">{field.inputType}</td>
                <td className="px-4 py-2 font-mono text-xs">
                  {field.targetColumn ?? (
                    <span className="text-[var(--color-ink-muted)]">
                      records · {field.recordKind}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-xs text-[var(--color-ink-muted)]">
                  {describeRule(field)}
                </td>
                <td className="px-4 py-2 text-right">
                  <form action={setFieldActive}>
                    <input type="hidden" name="key" value={field.key} />
                    <input
                      type="hidden"
                      name="active"
                      value={field.active ? "false" : "true"}
                    />
                    <button
                      type="submit"
                      className="text-xs text-[var(--color-ink-muted)] hover:underline"
                    >
                      {field.active ? "Switch off" : "Switch on"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="text-xs text-[var(--color-ink-muted)]">
        Fields are switched off rather than deleted — submissions, the change log
        and stored records all reference the key, and an inactive field simply
        stops being offered on new requests while its history stays readable.
      </p>

      {questions.length > 0 ? (
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card p-4 md:p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            One-off questions
          </h2>
          <p className="mt-1 max-w-prose text-sm text-[var(--color-ink-muted)]">
            Added from the request builder by anyone who can send a request.
            These never write to a student record — answers are stored against
            the request that asked them — which is why they do not need an owner
            to create.
          </p>
          <ul className="mt-3 divide-y divide-[var(--color-border)]">
            {questions.map((field) => (
              <li
                key={field.key}
                className={`flex items-center gap-3 py-2 ${
                  field.active ? "" : "opacity-50"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    {field.labelEn}
                    <span lang="hi" className="ml-2 text-[var(--color-ink-muted)]">
                      {field.labelHi}
                    </span>
                  </p>
                  <p className="font-mono text-xs text-[var(--color-ink-muted)]">
                    {field.key} · {field.inputType}
                  </p>
                </div>
                <form action={setFieldActive}>
                  <input type="hidden" name="key" value={field.key} />
                  <input
                    type="hidden"
                    name="active"
                    value={field.active ? "false" : "true"}
                  />
                  <button
                    type="submit"
                    className="text-xs text-[var(--color-ink-muted)] hover:underline"
                  >
                    {field.active ? "Switch off" : "Switch on"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function describeRule(field: typeof schema.fieldDefs.$inferSelect): string {
  const parts: string[] = [];
  if (field.exactLen) parts.push(`exactly ${field.exactLen}`);
  if (field.maxValue) parts.push(`max ${field.maxValue}`);
  if (Array.isArray(field.options) && field.options.length > 0) {
    parts.push((field.options as unknown[]).map(String).join(" / "));
  }
  return parts.join(" · ") || "—";
}

function Field({
  name,
  label,
  placeholder,
  required,
  lang,
}: {
  name: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  lang?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-[var(--color-ink-muted)]">
        {label}
      </span>
      <input
        name={name}
        lang={lang}
        placeholder={placeholder}
        required={required}
        className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand-600)]"
      />
    </label>
  );
}

function Select({
  name,
  label,
  options,
  labels,
}: {
  name: string;
  label: string;
  options: string[];
  labels?: Record<string, string>;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-[var(--color-ink-muted)]">
        {label}
      </span>
      <select
        name={name}
        className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {labels?.[option] ?? option}
          </option>
        ))}
      </select>
    </label>
  );
}
