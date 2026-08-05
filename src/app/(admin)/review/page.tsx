import { PhaseStub } from "@/components/admin/PhaseStub";

export default function ReviewPage() {
  return (
    <PhaseStub title="Review queue" phase="Phase 3 · not built yet">
      Batch approve or reject teacher submissions. Approval is one transaction:
      guard on <code className="font-mono">review_status = &apos;pending&apos;</code>,
      write <code className="font-mono">change_log</code>, then update{" "}
      <code className="font-mono">students</code> or{" "}
      <code className="font-mono">student_records</code>. Nothing reaches master
      without an explicit decision attached to a name and a timestamp.
    </PhaseStub>
  );
}
