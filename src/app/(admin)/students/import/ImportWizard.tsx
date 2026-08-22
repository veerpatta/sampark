"use client";

import { useState } from "react";
import Link from "next/link";
import type { ImportPreviewRow, ImportRowOutcome } from "@/lib/excel";
import { Card } from "@/components/admin/Card";
import { btn, field } from "@/components/ui/controls";

type ColumnOption = { value: string; label: string };

type Inspection = {
  headers: string[];
  rowCount: number;
  suggestion: Record<string, string>;
  sample: Record<string, string>[];
  /** Every sheet in the workbook. One entry, or none for CSV, hides the picker. */
  sheets: string[];
  sheet: string | null;
};

type Preview = {
  rows: ImportPreviewRow[];
  counts: Record<ImportRowOutcome, number>;
  /** Values a higher-precedence source owns, which this file may not write. */
  blockedCount: number;
};

export type SourceOption = { key: string; label: string };

const IGNORE = "";

/**
 * Upload -> map columns -> DRY RUN -> confirm. The dry run is the point of the
 * whole screen: the office sees exactly which students change and to what,
 * before a single row is written.
 */
export function ImportWizard({
  columns,
  sources,
}: {
  columns: ColumnOption[];
  sources: SourceOption[];
}) {
  const [file, setFile] = useState<File | null>(null);
  // No default. Which file this is decides what it is allowed to overwrite, and
  // a pre-selected source is a guess the office would have to notice was wrong.
  const [source, setSource] = useState("");
  const [sheet, setSheet] = useState<string | null>(null);
  const [sheetList, setSheetList] = useState<string[]>([]);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<{
    inserted: number;
    updated: number;
    blockedCount?: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function post(mode: string, wantedSheet?: string | null) {
    if (!file) return null;
    setBusy(true);
    setError(null);

    const body = new FormData();
    body.set("file", file);
    body.set("mode", mode);
    const chosen = wantedSheet === undefined ? sheet : wantedSheet;
    if (chosen) body.set("sheet", chosen);
    if (mode !== "inspect") {
      body.set("map", JSON.stringify(usableMap(map)));
      body.set("source", source);
    }

    try {
      const response = await fetch("/api/students/import", {
        method: "POST",
        body,
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Something went wrong.");
        // An empty sheet still tells us what the other sheets are called, so the
        // picker can appear instead of a dead end.
        if (Array.isArray(payload.sheets)) setSheetList(payload.sheets);
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

  async function onInspect(wantedSheet?: string | null) {
    setInspection(null);
    const payload = await post("inspect", wantedSheet);
    if (!payload) return;
    setInspection(payload);
    setSheetList(payload.sheets ?? []);
    setSheet(payload.sheet ?? null);
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
  const canDryRun =
    mapped.size > 0 && duplicates.length === 0 && (identifiable || insertable) && source !== "";

  return (
    <div className="space-y-8">
      {/* ---------------------------------------------------------- step 1 */}
      <Card step={1} title="Choose the file">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".csv,.xlsx"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setInspection(null);
              setSheet(null);
              setSheetList([]);
              setPreview(null);
              setResult(null);
              setError(null);
            }}
            className="text-sm file:mr-3 file:rounded-[var(--radius-control)] file:border-0 file:bg-[var(--color-surface-muted)] file:px-3 file:py-2 file:text-sm"
          />
          <button
            type="button"
            onClick={() => void onInspect()}
            disabled={!file || busy}
            className={btn({ tone: "primary" })}
          >
            {busy && !inspection ? "Reading…" : "Read file"}
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          CSV or XLSX, up to 5 MB. The first row must be the column headers.
        </p>

        {/* The fee app's bundle has fifteen sheets and the first is a README,
            so reading "the first sheet" silently reads the wrong one. */}
        {sheetList.length > 1 ? (
          <label className="mt-4 block max-w-sm">
            <span className="text-xs font-medium text-[var(--color-ink-muted)]">
              This workbook has {sheetList.length} sheets — which one holds the
              students?
            </span>
            <select
              value={sheet ?? ""}
              onChange={(event) => {
                setSheet(event.target.value);
                void onInspect(event.target.value);
              }}
              disabled={busy}
              className="mt-1 w-full rounded-[var(--radius-control)] border border-[var(--color-border)] px-3 py-2 text-sm"
            >
              {sheetList.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </Card>

      {error ? (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] border border-[var(--color-danger)] bg-[var(--color-danger-bg)] px-4 py-3 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      {/* ---------------------------------------------------------- step 2 */}
      {inspection ? (
        <Card
          step={2}
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
                      className="w-56 rounded-[var(--radius-control)] border border-[var(--color-border)] px-2 py-1.5 text-sm"
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

          {/*
            WHICH FILE IS THIS? Asked here rather than at upload, because it is
            not a property of the file on disk — it is a claim about who wrote
            it, and it decides what the file is allowed to overwrite. The fee
            app owns class allocation; PSP owns identity; neither may touch a
            field a teacher's approved correction or the office already claimed.
          */}
          <label className="mt-5 block border-t border-[var(--color-border)] pt-4">
            <span className="text-xs font-medium text-[var(--color-ink-muted)]">
              Where did this file come from?
            </span>
            <select
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className={`mt-1 max-w-sm ${field()}`}
            >
              <option value="">Choose one…</option>
              {sources.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-[var(--color-ink-muted)]">
              This decides what the file may overwrite. A value a teacher&rsquo;s
              approved correction owns, or one the office set by hand, is never
              replaced by an import.
            </span>
          </label>

          <button
            type="button"
            onClick={onDryRun}
            disabled={!canDryRun || busy}
            className={`${btn({ tone: "primary" })} mt-4`}
          >
            {busy ? "Checking…" : "Dry run — show me what would change"}
          </button>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------- step 3 */}
      {preview ? (
        <Card step={3} title="What this would do">
          <div className="flex gap-2.5">
            <Count label="New students" value={preview.counts.insert} tone="success" />
            <Count label="Updated" value={preview.counts.update} tone="brand" />
            <Count label="Unchanged" value={preview.counts.skip} tone="muted" />
            <Count label="Errors" value={preview.counts.error} tone="danger" />
          </div>

          {/*
            SAID OUT LOUD, NOT BURIED. The outcome the office most needs from a
            dry run is that a re-import of last term's export did NOT undo a
            month of approved corrections — and the only way to know that is to
            be told, rather than to read a clean-looking run that changed
            nothing where you expected changes.
          */}
          {preview.blockedCount > 0 ? (
            <Note tone="warning">
              {preview.blockedCount}{" "}
              {preview.blockedCount === 1 ? "value is" : "values are"} owned by
              something this file does not outrank and will be left alone. They
              are marked <strong>refused</strong> in the rows below — this is the
              protection working, not an error.
            </Note>
          ) : null}

          <PreviewTable rows={preview.rows} />

          {/* The only irreversible button on the screen, so it takes the
              commit shape: taller, rounder, full width. Everything above it is
              a dry run that wrote nothing. */}
          <div className="mt-5 space-y-2 border-t border-[var(--color-border)] pt-4">
            <button
              type="button"
              onClick={onApply}
              disabled={busy || preview.counts.insert + preview.counts.update === 0}
              className={btn({ shape: "commit", tone: "go", full: true })}
            >
              {busy
                ? "Writing…"
                : `Write ${preview.counts.insert + preview.counts.update} changes`}
            </button>
            <p className="text-xs text-[var(--color-ink-muted)]">
              Nothing has been written yet.
            </p>
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
  // teaches nobody anything. Show what moves — AND what was refused, which is a
  // 'skip' outcome but the opposite of uninteresting: the file disagreed with
  // the record and lost, which is the one thing a dry run must not hide.
  const interesting = rows.filter(
    (row) => row.outcome !== "skip" || (row.blocked?.length ?? 0) > 0,
  );
  const shown = interesting.slice(0, 200);

  if (interesting.length === 0) {
    return (
      <p className="mt-4 text-sm text-[var(--color-ink-muted)]">
        Every row already matches what is stored. Nothing would change.
      </p>
    );
  }

  return (
    <div className="mt-4 max-h-[28rem] overflow-auto rounded-[var(--radius-control)] border border-[var(--color-border)]">
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
                {row.blocked?.map((refusal) => (
                  <p
                    key={refusal.column}
                    className="mt-1 text-xs text-[var(--color-warning)]"
                  >
                    <span className="font-medium">refused</span>{" "}
                    <span className="text-[var(--color-ink-muted)]">
                      {refusal.column}:
                    </span>{" "}
                    <span className="line-through opacity-60">
                      {refusal.from ?? "empty"}
                    </span>{" "}
                    <span aria-hidden>→</span> {refusal.to} — {refusal.reason}
                  </p>
                ))}
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
          rows.
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
    error: "bg-[var(--color-danger-bg)] text-[var(--color-danger)]",
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

function Count({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "brand" | "muted" | "danger";
}) {
  // Tinted grounds rather than four identical bordered boxes. This is the one
  // moment in the wizard where the numbers ARE the content, and the office has
  // to read "12 new, 96 updated, nothing broken" at a glance before pressing
  // the only irreversible button on the screen. The tint carries the same
  // meaning as the colour of the numeral, so neither is load-bearing alone.
  const skin = {
    success: "bg-[var(--color-confirm-bg)] text-[var(--color-confirm-fg)]",
    brand: "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]",
    muted: "bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]",
    danger: "bg-[var(--color-danger-bg)] text-[var(--color-danger)]",
  }[tone];
  return (
    <div
      className={`min-w-0 flex-1 rounded-[var(--radius-commit)] px-3 py-2.5 ${skin}`}
    >
      <div className="text-[22px] font-semibold leading-tight">{value}</div>
      <div className="text-xs">{label}</div>
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
