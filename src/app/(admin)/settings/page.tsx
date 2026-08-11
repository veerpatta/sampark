import { redirect } from "next/navigation";
import { canManageSettings, currentUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/admin/PageHeader";
import { SettingsList } from "@/components/admin/SettingsList";

export const metadata = { title: "Settings — Sampark" };
export const dynamic = "force-dynamic";

/**
 * Where the six configuration screens live.
 *
 * The Settings tab used to go straight to /settings/teachers, which meant the
 * other five were reachable only from links inside pages that happened to
 * mention them — the field registry had no route to it at all from a phone.
 * With the nav at the bottom of the screen and no room for a sixth and seventh
 * tab, an index is the only honest way to expose them.
 *
 * Import sits here despite living under /students, because "load a file the
 * fee app exported" is a thing the office does twice a year at setup, not part
 * of working the student board.
 *
 * Every page linked from here is owner-only and checks that for itself. The
 * check is repeated here so the list is not a menu of six redirects.
 */
const ITEMS = [
  {
    href: "/settings/teachers",
    label: "Teachers",
    note: "Numbers, the classes and houses they own, durable links",
  },
  {
    href: "/settings/fields",
    label: "Field registry",
    note: "What can be collected, and whether it is verified or collected",
  },
  {
    href: "/settings/subjects",
    label: "Subjects",
    note: "Who teaches what",
  },
  {
    href: "/students/import",
    label: "Import students",
    note: "From a PSP or fee-app export — matched on ID, never on name",
  },
  {
    href: "/settings/users",
    label: "Admin users",
    note: "owner · admin · office",
  },
  {
    href: "/settings/audit",
    label: "Audit log",
    note: "Every approved or rejected change, append-only",
  },
];

export default async function SettingsPage() {
  const session = await currentUser();
  if (!session || !canManageSettings(session.role)) redirect("/");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Teachers and admin users are never seeded from a file — both carry personal data."
      />
      <SettingsList items={ITEMS} />
    </div>
  );
}
