import { notFound } from "next/navigation";

/**
 * The only page a teacher ever sees.
 *
 * No admin shell, no navigation, no menu — a link opens exactly one class and
 * exactly the fields requested. Authorization is resolved in
 * `src/lib/auth/token.ts` and nowhere else.
 *
 * Every rejection (unknown token, expired, closed, wrong PIN) must render an
 * identical 404. Never leak WHY a token failed.
 *
 * TODO (Phase 2): resolve the token, render the frozen roster read-only.
 * TODO (Phase 3): add the सही है / बदलें / नहीं है row actions and submit.
 */
export default async function TeacherRequestPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Phase 2 replaces this with a real lookup. Until then every token 404s,
  // which is the correct fail-closed behaviour for an unbuilt surface.
  const request = null as { title: string } | null;
  if (!request) notFound();

  return (
    <main className="teacher-surface mx-auto max-w-md p-4">
      <p className="font-mono text-xs text-[var(--color-ink-muted)]">{token}</p>
    </main>
  );
}
