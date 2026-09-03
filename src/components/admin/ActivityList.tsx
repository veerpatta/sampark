import Link from "next/link";
import { decisionChip } from "@/components/ui/controls";
import type { ActivityEvent } from "@/lib/activity";

const WORD: Record<ActivityEvent["kind"], string> = {
  approved: "approved",
  rejected: "rejected",
  edited: "edited",
  created: "created",
  answered: "answered",
  sent: "sent",
};

/** The last few things that happened, newest first, each a link to where it shows. */
export function ActivityList({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="p-4 text-sm text-[var(--color-ink-muted)]">
        Nothing yet. Sends, answers and decisions will appear here as they happen.
      </p>
    );
  }
  return (
    <ul>
      {events.map((event) => (
        <li key={event.key} className="border-b border-[var(--color-border)] last:border-0">
          {/* The whole row is the link — a line of text is not a target on a
              phone, and this is a list the office scans with a thumb. */}
          <Link
            href={event.href}
            className="flex min-h-[var(--tap-min)] items-start gap-3 px-4 py-2.5 text-sm active:bg-[var(--color-surface-muted)] md:min-h-0"
          >
            <span className={`mt-0.5 shrink-0 ${decisionChip(event.kind)}`}>{WORD[event.kind]}</span>
            <span className="min-w-0 flex-1">
              {event.who ? <span className="font-medium">{event.who} </span> : null}
              {event.title}
              <span className="block font-mono text-xs text-[var(--color-ink-muted)]">{relative(event.at)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** "3 minutes ago", "yesterday", "12 Aug" — the closest word, not a timestamp. */
export function relative(at: Date, now = new Date()): string {
  const seconds = Math.round((now.getTime() - at.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(at);
}
