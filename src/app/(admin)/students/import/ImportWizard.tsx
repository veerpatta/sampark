"use client";

import { useState } from "react";
import Link from "next/link";
import type { ImportPreviewRow, ImportRowOutcome } from "@/lib/excel";

type ColumnOption = { value: string; label: string };

type Inspection = {
  headers: string[];
  rowCount: number;
  suggestion: Record<string, string>;
  sample: Record<string, string>[];
};

type Preview = {
  rows: ImportPreviewRow[];
  counts: Record<ImportRowOutcome, number>;
};

const IGNORE = "";

/**
 * Upload -> map columns -> DRY RUN -> confirm. The dry run is the point of the
 * whole screen: the office sees exactly which students change and to what,
 * before a single row is written.
 */
export function ImportWizard({ columns }: { columns: ColumnOption[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<{ inserted: number; updated: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function post(mode: string) {
    if (!file) return null;
    setBusy(true);
    setError(null);

    const body = new FormData();
    body.set("file", file);
    body.set("mode", mode);
    if (mode !== "inspect") body.set("map", JSON.stringify(usableMap(map)));

    try {
      const response = await fetch("/api/students/import", {
        method: "POST",
        body,
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Something went wrong.");
        return null;
      }
      return payload;
    } catch {
      setError("Could not reach the server. Check your connection.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function onInspect() {
    const payload = await post("inspect");
    if (!payload) return;
    setInspection(payload);
    setMap(payload.suggestion ?? {});
    setPreview(null);
    setResult(null);
  }

  async function onDryRun() {
    const payload = await post("preview");
    if (payload) setPreview(payload);
  }

  async function onApply() {
    const payload = await post("apply");
    if (payload) {
      setResult({ inserted: payload.inserted, updated: payload.updated });
      setPreview(null);
    }
  }

  const mapped = new Set(Object.values(map).filter(Boolean));
  const identifiable = mapped.has("id") || mapped.has("srNo");
  const insertable = mapped.has("name") && mapped.has("classLabel");
  const duplicates = findDuplicateTargets(map);
  const canDryRun = mapped.size > 0 && duplicates.length === 0 && (identifiable || insertable);

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------- step 1 */}
      <Card step="1" title="Choose the file">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".csv,.xlsx"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setInspection(null);
              setPreview(null);
              setResult(null);
              setError(null);
            }}
            className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--color-surface-muted)] file:px-3 file:py-2 file:text-sm"
          />
          <button
            type="button"
            onClick={onInspect}
            disabled={!file || busy}
            className="rounded-lg bg-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-700)] disabled:opacity-50"
          >
            {busy && !inspection ? "Reading…" : "Read file"}
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          CSV or XLSX, up to 5 MB. The first row must be the column headers.
        </p>
      </Card>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-[var(--color-danger)] bg-red-50 px-4 py-3 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      {/* ---------------------------------------------------------- step 2 */}
      {inspection ? (
        <Card
          step="2"
          title={`Map the columns — ${inspection.rowCount} rows found`}
        >
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">
              <tr>
                <th className="py-2">Column in your file</th>
                <th className="py-2">First few values</th>
                <th className="py-2">Goes to</th>
              </tr>
            </thead>
            <tbody>
              {inspection.headers.map((header) => (
                <tr
                  key={header}
                  className="border-t border-[var(--color-border)]"
                >
                  <td className="py-2 pr-4 font-medium">{header}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-[var(--color-ink-muted)]">
                    {inspection.sample
                      .map((row) => row[header])
                      .filter(Boolean)
                      .slice(0, 3)
                      .join(" · ") || "—"}
                  </td>
                  <td className="py-2">
                    <select
                      value={map[header] ?? IGNORE}
                      onChange={(event) =>
                        setMap((current) => ({
                          ...current,
                          [header]: event.target.value,
                        }))
                      }
                      className="w-56 rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-sm"
                    >
                      <option value={IGNORE}>— ignore this column —</option>
                      {columns.map((column) => (
                        <option key={column.value} value={column.value}>
                          {column.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 space-y-2 text-sm">
            {duplicates.length > 0 ? (
              <Note tone="danger">
                {duplicates.join(", ")} {duplicates.length === 1 ? "is" : "are"}{" "}
                mapped from more than one column. Each field can come from only
                one place.
              </Note>
            ) : null}

            {!identifiable ? (
              <Note tone="warning">
                No Student ID or SR number column. Every row will be treated as
                a new student, and importing this file twice would create every
                child twice. Map one if your export has it.
              </Note>
            ) : null}

            {identifiable && !insertable ? (
              <Note tone="muted">
                Rows that match an existing student will be updated. Rows that
                do not match need both a name and a class to be created.
              </Note>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onDryRun}
            disabled={!canDryRun || busy}
            className="mt-4 rounded-lg bg-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-700)] disabled:opacity-50"
          >
            {busy ? "Checking…" : "Dry run — show me what would change"}
          </button>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------- step 3 */}
      {preview ? (
        <Card step="3" title="What this would do">
          <div className="flex flex-wrap gap-3">
            <Count label="New students" value={preview.counts.insert} tone="success" />
            <Count label="Updated" value={preview.counts.update} tone="brand" />
            <Count label="Unchanged" value={preview.counts.skip} tone="muted" />
            <Count label="Errors" value={preview.counts.error} tone="danger" />
          </div>

          <PreviewTable rows={preview.rows} />

          <div className="mt-5 flex items-center gap-3 border-t border-[var(--color-border)] pt-4">
            <button
              type="button"
              onClick={onApply}
              disabled={busy || preview.counts.insert + preview.counts.update === 0}
              className="rounded-lg bg-[var(--color-success)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy
                ? "Writing…"
                : `Write ${preview.counts.insert + preview.counts.update} changes`}
            </button>
            <span className="text-xs text-[var(--color-ink-muted)]">
              Nothing has been written yet.
            </span>
          </div>
        </Card>
      ) : null}

      {/* ------------------------------------------------------------ done */}
      {result ? (
        <Card step="✓" title="Done">
          <p className="text-sm">
            {result.inserted} student{result.inserted === 1 ? "" : "s"} created,{" "}
            {result.updated} updated.
          </p>
          <Link
            href="/students"
            className="mt-3 inline-block text-sm font-medium text-[var(--color-brand-600)] hover:underline"
          >
            Go to the student list →
          </Link>
        </Card>
      ) : null}
    </div>
  );
}

function PreviewTable({ rows }: { rows: ImportPreviewRow[] }) {
  // Unchanged rows are the majority of a healthy re-import and reading them
  // teaches nobody anything. Show what moves.
  const interesting = rows.filter((row) => row.outcome !== "skip");
  const shown = interesting.slice(0, 200);

  if (interesting.length === 0) {
    return (
      <p className="mt-4 text-sm text-[var(--color-ink-muted)]">
        Every row already matches what is stored. Nothing would change.
      </p>
    );
  }

  return (
    <div className="mt-4 max-h-[28rem] overflow-auto rounded-lg border border-[var(--color-border)]">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-[var(--color-surface-muted)] text-left text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">
          <tr>
            <th className="px-3 py-2">Row</th>
            <th className="px-3 py-2">Student</th>
            <th className="px-3 py-2">Matched</th>
            <th className="px-3 py-2">Changes</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr
              key={row.rowNumber}
              className="border-t border-[var(--color-border)] align-top"
            >
              <td className="px-3 py-2 font-mono text-xs">{row.rowNumber}</td>
              <td className="px-3 py-2">
                <OutcomeTag outcome={row.outcome} />
                <div className="mt-1 font-mono text-xs text-[var(--color-ink-muted)]">
                  {row.studentId ?? "—"}
                </div>
              </td>
              <td className="px-3 py-2 text-xs text-[var(--color-ink-muted)]">
                {row.matchedBy === "id"
                  ? "Student ID"
                  : row.matchedBy === "sr_no"
                    ? "SR number"
                    : "—"}
              </td>
              <td className="px-3 py-2">
                {row.message ? (
                  <p className="text-xs text-[var(--color-danger)]">
                    {row.message}
                  </p>
                ) : null}
                <ul className="space-y-0.5">
                  {Object.entries(row.changes).map(([field, change]) => (
                    <li key={field} className="text-xs">
                      <span className="text-[var(--color-ink-muted)]">
                        {field}:
                      </span>{" "}
                      <span className="line-through opacity-60">
                        {change.from ?? "empty"}
                      </span>{" "}
                      <span aria-hidden>→</span>{" "}
                      <span className="font-medium">{change.to}</span>
                    </li>
                  ))}
                </ul>
                {row.warnings.map((warning) => (
                  <p
                    key={warning}
                    className="mt-1 text-xs text-[var(--color-warning)]"
                  >
                    {warning}
                  </p>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {interesting.length > shown.length ? (
        <p className="border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-xs text-[var(--color-ink-muted)]">
          Showing the first {shown.length} of {interesting.length} affected
          rows. All {interesting.length} will be written.
        </p>
      ) : null}
    </div>
  );
}

function OutcomeTag({ outcome }: { outcome: ImportRowOutcome }) {
  const style: Record<ImportRowOutcome, string> = {
    insert: "bg-[var(--color-confirm-bg)] text-[var(--color-confirm-fg)]",
    update: "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]",
    skip: "bg-[var(--color-absent-bg)] text-[var(--color-absent-fg)]",
    error: "bg-red-50 text-[var(--color-danger)]",
  };
  const label: Record<ImportRowOutcome, string> = {
    insert: "new",
    update: "update",
    skip: "unchanged",
    error: "error",
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${style[outcome]}`}
    >
      {label[outcome]}
    </span>
  );
}

function Card({
  step,
  title,
  children,
}: {
  step: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-surface-muted)] font-mono text-xs">
          {step}
        </span>
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Count({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "brand" | "muted" | "danger";
}) {
  const colour = {
    success: "text-[var(--color-success)]",
    brand: "text-[var(--color-brand-600)]",
    muted: "text-[var(--color-ink-muted)]",
    danger: "text-[var(--color-danger)]",
  }[tone];
  return (
    <div className="rounded-lg border border-[var(--color-border)] px-4 py-2">
      <div className={`text-xl font-semibold ${colour}`}>{value}</div>
      <div className="text-xs text-[var(--color-ink-muted)]">{label}</div>
    </div>
  );
}

function Note({
  tone,
  children,
}: {
  tone: "danger" | "warning" | "muted";
  children: React.ReactNode;
}) {
  const colour = {
    danger: "text-[var(--color-danger)]",
    warning: "text-[var(--color-warning)]",
    muted: "text-[var(--color-ink-muted)]",
  }[tone];
  return <p className={`text-xs ${colour}`}>{children}</p>;
}

/** Drop ignored columns before sending the map to the server. */
function usableMap(map: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(map).filter(([, column]) => Boolean(column)),
  );
}

function findDuplicateTargets(map: Record<string, string>): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const column of Object.values(map)) {
    if (!column) continue;
    if (seen.has(column)) duplicates.add(column);
    seen.add(column);
  }
  return [...duplicates];
}
