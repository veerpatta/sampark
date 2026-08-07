import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { canCreateRequests, currentUser } from "@/lib/auth/session";
import { getBatch } from "@/lib/batches";
import { SendQueue } from "./SendQueue";

export const metadata = { title: "Send queue — Sampark" };
export const dynamic = "force-dynamic";

export default async function BatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await currentUser();
  if (!session || !canCreateRequests(session.role)) redirect("/");

  const { id } = await params;
  const detail = await getBatch(id);
  if (!detail) notFound();

  const host = (await headers()).get("host") ?? "";
  const origin = `${host.startsWith("localhost") ? "http" : "https"}://${host}`;

  const { batch, links } = detail;

  return (
    <div className="space-y-8">
      <header>
        <div className="flex items-baseline gap-3">
          <h1 className="text-display font-semibold tracking-tight">
            {batch.title}
          </h1>
          <Link
            href="/requests"
            className="text-sm text-[var(--color-brand-600)] hover:underline"
          >
            back to the board
          </Link>
        </div>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          {links.length} {links.length === 1 ? "link" : "links"} · due{" "}
          {batch.dueDate}
        </p>
      </header>

      <SendQueue
        batchId={batch.id}
        title={batch.title}
        dueDate={batch.dueDate}
        origin={origin}
        links={links.map((link) => ({
          requestId: link.requestId,
          token: link.token,
          audienceKind: link.audienceKind,
          audienceLabel: link.audienceLabel,
          fieldKeys: link.fieldKeys,
          teacherName: link.teacherName,
          teacherPhone: link.teacherPhone,
          rosterSize: link.rosterSize,
          sent: link.sentAt !== null,
        }))}
      />
    </div>
  );
}
