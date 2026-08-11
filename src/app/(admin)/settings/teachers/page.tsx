import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canManageSettings, currentUser } from "@/lib/auth/session";
import { CLASS_LABELS } from "@/lib/classes";
import { HOUSES } from "@/lib/houses";
import { BUS_ROUTES } from "@/lib/routes";
import { saveTeacher, setTeacherActive } from "./actions";
import { TeacherLinkPanel } from "./TeacherLinkPanel";
import { RevokeAllLinks } from "./RevokeAllLinks";
import { btn } from "@/components/ui/controls";

export const metadata = { title: "Teachers — Sampark" };
export const dynamic = "force-dynamic";

/**
 * Teachers and what they own.
 *
 * Three kinds of ownership, and a bulk send resolves a recipient from whichever
 * one the office scoped to. `classes` is the common case; `houses` and `routes`
 * exist because those groups cut across classes, so a house-wise link goes to
 * one house master rather than to nineteen class teachers.
 *
 * Assignments are checkboxes over the canonical lists rather than a typed
 * comma-separated string. Typing was the failure mode this screen actually had:
 * "12 Science" instead of "12 Sci" matches no student and the teacher silently
 * never gets offered as that class's owner. A checkbox cannot be misspelt.
 *
 * One card per teacher, not a table. The previous version used `form={...}` to
 * scatter one form's inputs across table cells, which has no card equivalent —
 * and this is a screen someone opens on a phone to fix a wrong number.
 */
export default async function TeachersPage() {
  const session = await currentUser();
  if (!session || !canManageSettings(session.role)) redirect("/");

  const teachers = await db
    .select()
    .from(schema.teachers)
    .orderBy(asc(schema.teachers.name));

  // The host the office is actually on, so the link she copies is the link that
  // works. Same approach as the batch send queue.
  const host = (await headers()).get("host") ?? "";
  const origin = `${host.startsWith("localhost") ? "http" : "https"}://${host}`;
  const withLinks = teachers.filter((teacher) => teacher.linkToken).length;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-display font-semibold">Teachers</h1>
        <p className="mt-1 max-w-prose text-[13px] text-[var(--color-ink-muted)]">
          Phone numbers are 10 digits with no country code — the WhatsApp link
          builder adds 91. Tick the classes a teacher owns; tick a house or a bus
          route only for the teacher who should receive a link for that whole
          group.
        </p>
      </header>

      <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card p-4 md:p-6">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">
          Add a teacher
        </h2>
        <form action={saveTeacher} className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field name="id" label="ID" placeholder="T01" required />
            <Field name="name" label="Name" required />
            <Field
              name="phone"
              label="Phone"
              placeholder="9XXXXXXXXX"
              inputMode="numeric"
              required
            />
          </div>
          <Assignments />
          <input type="hidden" name="active" value="on" />
          <button
            type="submit"
            className={`${btn({ tone: "primary" })} w-full md:w-auto`}
          >
            Add teacher
          </button>
        </form>
      </section>

      {teachers.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-ink-muted)]">
          No teachers yet. Add the class teachers above — a request cannot be
          created without one.
        </p>
      ) : (
        <ul className="space-y-3">
          {teachers.map((teacher) => (
            <li
              key={teacher.id}
              className={`rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card ${
                teacher.active ? "" : "opacity-60"
              }`}
            >
              <details>
                {/* Closed, this is a readable summary. Open, it is the editor —
                    so the list stays scannable on a phone and editing is a
                    deliberate tap rather than a field under every finger. */}
                <summary className="flex min-h-[var(--tap-min)] cursor-pointer list-none items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-name font-medium">
                      {teacher.name}
                      {teacher.active ? null : (
                        <span className="ml-2 text-meta font-normal text-[var(--color-ink-muted)]">
                          inactive
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 truncate text-label text-[var(--color-ink-muted)]">
                      <span className="font-mono">{teacher.phone}</span>
                      {" · "}
                      {describeOwnership(teacher)}
                    </p>
                  </div>
                  <span
                    aria-hidden
                    className="text-[var(--color-ink-muted)]"
                  >
                    ▾
                  </span>
                </summary>

                <div className="border-t border-[var(--color-border)] p-4">
                  <form action={saveTeacher} className="space-y-4">
                    <input type="hidden" name="id" value={teacher.id} />
                    <input
                      type="hidden"
                      name="active"
                      value={teacher.active ? "on" : "off"}
                    />

                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field
                        name="name"
                        label="Name"
                        defaultValue={teacher.name}
                        required
                      />
                      <Field
                        name="phone"
                        label="Phone"
                        defaultValue={teacher.phone}
                        inputMode="numeric"
                        required
                      />
                    </div>

                    <Assignments
                      classes={teacher.classes}
                      houses={teacher.houses}
                      routes={teacher.routes}
                    />

                    <button
                      type="submit"
                      className={`${btn({ tone: "primary" })} w-full md:w-auto`}
                    >
                      Save {teacher.name}
                    </button>
                  </form>

                  <TeacherLinkPanel
                    teacherId={teacher.id}
                    teacherName={teacher.name}
                    phone={teacher.phone}
                    origin={origin}
                    token={teacher.linkToken}
                    issuedAt={teacher.linkIssuedAt}
                  />

                  {/* Deactivate rather than delete: requests reference
                      teacher_id, and a teacher who left mid-year must not take
                      her class's request history with her. */}
                  <form
                    action={setTeacherActive}
                    className="mt-3 border-t border-[var(--color-border)] pt-3"
                  >
                    <input type="hidden" name="id" value={teacher.id} />
                    <input
                      type="hidden"
                      name="active"
                      value={teacher.active ? "false" : "true"}
                    />
                    <button
                      type="submit"
                      className="inline-flex min-h-[var(--tap-min)] items-center text-label text-[var(--color-ink-muted)] hover:underline"
                    >
                      {teacher.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </form>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}

      <RevokeAllLinks count={withLinks} />
    </div>
  );
}

/** "Class 6, Class 7 · Rana Pratap house" — or an honest gap. */
function describeOwnership(teacher: {
  classes: string[];
  houses: string[];
  routes: string[];
}): string {
  const parts: string[] = [];
  if (teacher.classes.length > 0) parts.push(teacher.classes.join(", "));
  if (teacher.houses.length > 0) {
    parts.push(`${teacher.houses.join(", ")} house`);
  }
  if (teacher.routes.length > 0) parts.push(teacher.routes.join(", "));
  return parts.join(" · ") || "nothing assigned";
}

/**
 * The three assignment lists.
 *
 * Checkboxes with a repeated name, read back with `getAll`. Deliberately not a
 * client component: a chip that toggles a hidden input needs JavaScript, and
 * `peer-checked` does the same job in CSS with a real form control underneath,
 * which keeps it keyboard-reachable and submittable without hydration.
 */
function Assignments({
  classes = [],
  houses = [],
  routes = [],
}: {
  classes?: string[];
  houses?: string[];
  routes?: string[];
}) {
  return (
    <div className="space-y-4">
      <ChipGroup
        name="classes"
        label="Classes"
        options={[...CLASS_LABELS]}
        selected={classes}
      />
      <ChipGroup
        name="houses"
        label="House in-charge"
        options={HOUSES.map((house) => house.name)}
        selected={houses}
        hint="Only for the teacher who should receive a link for the whole house."
      />
      {/* 29 routes unprompted is a wall at 390px, and most teachers own none. */}
      <details>
        <summary className="min-h-[var(--tap-min)] cursor-pointer list-none py-2 text-xs font-medium text-[var(--color-brand-600)]">
          Bus route in-charge{routes.length > 0 ? ` (${routes.length})` : ""} ▾
        </summary>
        <ChipGroup
          name="routes"
          label=""
          options={[...BUS_ROUTES]}
          selected={routes}
        />
      </details>
    </div>
  );
}

function ChipGroup({
  name,
  label,
  options,
  selected,
  hint,
}: {
  name: string;
  label: string;
  options: string[];
  selected: string[];
  hint?: string;
}) {
  const chosen = new Set(selected);
  return (
    <fieldset>
      {label ? (
        <legend className="text-xs font-medium text-[var(--color-ink-muted)]">
          {label}
        </legend>
      ) : null}
      {hint ? (
        <p className="mt-0.5 text-meta text-[var(--color-ink-muted)]">{hint}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option} className="cursor-pointer">
            <input
              type="checkbox"
              name={name}
              value={option}
              defaultChecked={chosen.has(option)}
              className="peer sr-only"
            />
            <span className="flex min-h-[var(--tap-min)] items-center rounded-[var(--radius-chip)] border border-[var(--color-border)] px-4 text-sm transition-transform active:scale-[0.98] peer-checked:border-[var(--color-brand-600)] peer-checked:bg-[var(--color-brand-50)] peer-checked:font-medium peer-checked:text-[var(--color-brand-700)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-brand-600)]">
              {option}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Field({
  name,
  label,
  placeholder,
  required,
  defaultValue,
  inputMode,
}: {
  name: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
  inputMode?: "numeric";
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
        defaultValue={defaultValue}
        inputMode={inputMode}
        className="mt-1 min-h-[var(--tap-min)] w-full rounded-[var(--radius-control)] border border-[var(--color-border)] px-3 text-sm outline-none focus:border-[var(--color-brand-600)]"
      />
    </label>
  );
}
