import Link from "next/link";

/**
 * The other settings screens, one line under the title.
 *
 * On a pointer only: below md the bottom nav's Settings tab lands on an index
 * of all six, so this row would be the same navigation twice — and it is the
 * row that pushes the actual content off the first screen of a phone.
 *
 * One component, because five pages each carried a hand-typed copy of this
 * list and each copy had drifted to a different subset of the others.
 */
const SCREENS: [href: string, label: string][] = [
  ["/settings/teachers", "teachers"],
  ["/settings/fields", "field registry"],
  ["/settings/subjects", "subjects"],
  ["/students/import", "import students"],
  ["/settings/users", "admin users"],
  ["/settings/audit", "audit log"],
];

export function SettingsCrumbs({ current }: { current: string }) {
  return (
    <div className="-mt-3 hidden flex-wrap items-baseline gap-3 md:flex">
      {SCREENS.filter(([href]) => href !== current).map(([href, label]) => (
        <Link key={href} href={href} className="text-sm text-[var(--color-brand-600)] hover:underline">
          {label}
        </Link>
      ))}
    </div>
  );
}
