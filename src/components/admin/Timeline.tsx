import Link from "next/link";
import { decisionChip } from "@/components/ui/controls";
import { PhotoDiff } from "./StudentPhoto";
import type { TimelineEvent } from "@/lib/student-timeline";

/**
 * A child's history, read down the page.
 *
 * A list, not a table — the same reasoning the old change-history card gave:
 * when, who, what, and the diff is 700px of columns on a 360px screen. Every
 * entry is one thing that happened, so it reads as one block.
 */
const KIND_WORD: Record<TimelineEvent["kind"], string> = {
  created: "created",
  edited: "edited",
  approved: "approved",
  rejected: "rejected",
  submitted: "answered",
  recorded: "recorded",
  included: "asked",
  document_added: "document",
  document_removed: "removed",
};

export function Timeline({
  events,
  studentName,
  empty,
}: {
  events: TimelineEvent[];
  studentName: string;
  empty: React.ReactNode;
}) {
  if (events.length === 0) {
    return <p className="p-4 text-sm text-[var(--color-ink-muted)]">{empty}</p>;
  }

  return (
    <ol>
      {events.map((event) => (
        <li key={event.key} className="border-b border-[var(--color-border)] px-4 py-3 last:border-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-mono text-xs text-[var(--color-ink-muted)]">
              {formatWhen(event.at)}
            </span>
            {event.who ? (
              <span className="text-xs text-[var(--color-ink-muted)]">· {event.who}</span>
            ) : null}
            <span className={`ml-auto ${decisionChip(event.kind)}`}>{KIND_WORD[event.kind]}</span>
          </div>
          <div className="mt-1 text-sm">
            {event.href ? (
              <Link href={event.href} className="hover:underline">
                {event.title}
              </Link>
            ) : (
              event.title
            )}
          </div>

          {event.lines.length > 0 ? (
            <ul className="mt-1.5 space-y-1">
              {event.lines.map((line, index) => (
                <li key={index} className="text-xs">
                  <span className="text-[var(--color-ink-muted)]">{line.label}</span>
                  {line.photo && (line.from !== undefined || line.to !== undefined) ? (
                    <div className="mt-1">
                      <PhotoDiff before={line.from ?? null} after={line.to ?? null} name={studentName} />
                    </div>
                  ) : line.from !== undefined || line.to !== undefined ? (
                    <span className="ml-2 font-mono">
                      {line.from !== undefined ? (
                        <>
                          <span className="line-through opacity-60">{line.from ?? "empty"}</span>
                          <span className="mx-1.5" aria-hidden>
                            →
                          </span>
                        </>
                      ) : null}
                      <span className="font-medium">{line.to ?? "empty"}</span>
                    </span>
                  ) : null}
                  {line.meta ? (
                    <span className="ml-2 text-[var(--color-ink-faint)]">{line.meta}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {event.note ? (
            <p className="mt-1.5 text-xs italic text-[var(--color-ink-muted)]">“{event.note}”</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function formatWhen(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(value);
}

export function formatDay(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(value);
}
