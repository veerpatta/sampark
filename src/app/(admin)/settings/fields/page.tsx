import { PhaseStub } from "@/components/admin/PhaseStub";

export default function FieldSettingsPage() {
  return (
    <PhaseStub title="Field registry" phase="Phase 6 · not built yet">
      Owner-only editor for <code className="font-mono">field_defs</code>. Adding
      a collectable field is a database row, not a deployment — that is the whole
      point of the registry. The starting fourteen fields are seeded from{" "}
      <code className="font-mono">drizzle/seed/field_defs.ts</code>.
    </PhaseStub>
  );
}
