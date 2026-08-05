import { PhaseStub } from "@/components/admin/PhaseStub";

export default function StudentsPage() {
  return (
    <PhaseStub title="Students" phase="Phase 1 · not built yet">
      The master record, searchable and filterable by class. Loaded from a real
      PSP export via <code className="font-mono">/students/import</code> — match
      on student ID first, then SR number, never on name. A blank cell means no
      change, not erase.
    </PhaseStub>
  );
}
