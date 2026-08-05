import { PhaseStub } from "@/components/admin/PhaseStub";

export default function RequestsPage() {
  return (
    <PhaseStub title="Requests" phase="Phase 2 · not built yet">
      Status board for every request. Creating one generates a 16-char
      crypto-random token and freezes the class roster into{" "}
      <code className="font-mono">request_students</code> as a JSONB snapshot, so
      review stays truthful even if master data moves underneath it.
    </PhaseStub>
  );
}
