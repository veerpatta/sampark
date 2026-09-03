"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { eyebrow } from "@/components/ui/controls";

/**
 * The last few children this browser opened.
 *
 * A parent rings back, the office reopens the same page. Five chips in local
 * storage save a search — and nothing more, which is why this lives on the
 * browser and never on the server: it is a convenience of this device, not a
 * fact about the school.
 *
 * Renders nothing until mounted, so the server's empty markup and the first
 * client paint agree.
 */
export const RECENT_KEY = "sampark.students.recent";
export const RECENT_MAX = 5;

export type RecentStudent = { id: string; name: string; classLabel: string };

export function readRecent(): RecentStudent[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (row): row is RecentStudent =>
            typeof row === "object" && row !== null && typeof (row as RecentStudent).id === "string",
        )
      : [];
  } catch {
    return [];
  }
}

export function RecentStudents() {
  const [recent, setRecent] = useState<RecentStudent[] | null>(null);

  useEffect(() => {
    setRecent(readRecent());
  }, []);

  if (!recent || recent.length === 0) return null;

  return (
    <section>
      <h2 className={eyebrow()}>Recently opened</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        {recent.map((row) => (
          <Link
            key={row.id}
            href={`/students/${encodeURIComponent(row.id)}`}
            className="inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-chip)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm hover:border-[var(--color-brand-600)]"
          >
            {row.name}
            <span className="text-xs text-[var(--color-ink-muted)]">{row.classLabel}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
