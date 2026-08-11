"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Template } from "@/lib/templates";
import {
  buildRequestMessage,
} from "@/lib/whatsapp";
import { chooseTeacherForClass, type TeacherLike } from "@/lib/teachers";
import { hasPhone } from "@/lib/phone";
import { useToast } from "@/components/ui/Toast";
import { openWhatsApp } from "@/components/ui/share";
import { btn, card, chip, eyebrow } from "@/components/ui/controls";

type ClassOption = { label: string; students: number };
type TeacherOption = TeacherLike & { phone: string };

/**
 * Class, template, send.
 *
 * The office mostly uses this app standing in a corridor with a phone, to fire
 * off one WhatsApp link. That path used to be: dashboard, new request, pick a
 * class, pick fields, type a title, pick a teacher, pick a date, create, then
 * find the share panel. It is now three taps, and everything in between has a
 * default: the teacher from the class, the due date five days out, the title
 * and fields from the template.
 *
 * The full builder is still there and still the way to do anything unusual.
 * This is the common case, given its own front door.
 *
 * TWO TEACHERS ON ONE CLASS IS NOT GUESSED AT. The send button becomes a link
 * into the builder with the class and template already applied, because the
 * one thing worse than four taps is a link sent to the wrong teacher.
 */
export function QuickSend({
  classes,
  teachers,
  templates,
}: {
  classes: ClassOption[];
  teachers: TeacherOption[];
  templates: Template[];
}) {
  const [classLabel, setClassLabel] = useState("");
  const [template, setTemplate] = useState<Template | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  const choice = chooseTeacherForClass(teachers, classLabel);
  const teacher =
    choice.kind === "one"
      ? teachers.find((option) => option.id === choice.teacherId)!
      : null;

  // Marks need a period typed in, so that template hands over to the builder
  // rather than inventing one.
  const needsBuilder =
    (template && template.fieldKeys.some((key) => key.startsWith("fa_"))) ||
    choice.kind !== "one" ||
    (teacher && !hasPhone(teacher.phone));

  const builderHref = `/requests/new?class=${encodeURIComponent(classLabel)}${
    template ? `&template=${encodeURIComponent(template.name)}` : ""
  }`;

  async function send() {
    if (!classLabel || !template || !teacher) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: template.name,
          classLabel,
          teacherId: teacher.id,
          fieldKeys: template.fieldKeys,
          dueDate: plusFiveDays(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Could not create the request.");
        return;
      }

      // No second round trip for the message: the POST already returned the
      // token, and both builders are pure functions safe in a browser.
      const url = `${window.location.origin}/r/${payload.token}`;
      const message = buildRequestMessage({
        teacherName: teacher.name,
        audience: { kind: "class", label: classLabel },
        title: template.name,
        dueDate: plusFiveDays(),
        url,
      });

      // Straight to her chat. The only call site that cannot be a plain <a>:
      // the token does not exist until the POST above returns, so there is no
      // href to render. If the browser blocks the tab because the tap is no
      // longer "recent" we leave this page for WhatsApp instead, and the
      // request is already created either way.
      const outcome = openWhatsApp({ phone: teacher.phone, message });

      if (outcome === "navigated") return;

      toast({
        message: `Sent to ${teacher.name} for ${classLabel}.`,
        undoLabel: "Open it",
        undo: () => router.push(`/requests/${payload.id}`),
      });
      router.refresh();
      setTemplate(null);
      setClassLabel("");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const usable = classes.filter((option) => option.students > 0);
  if (usable.length === 0 || teachers.length === 0) return null;

  return (
    <section className={`${card()} p-4 md:p-6`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={eyebrow()}>Send a link</h2>
        <Link
          href="/requests/bulk"
          className="text-[13px] font-medium text-[var(--color-brand-600)] hover:underline"
        >
          Send to many →
        </Link>
      </div>

      {/* -------------------------------------------------------- tap one */}
      <div className="mt-3 flex flex-wrap gap-2">
        {usable.map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() =>
              setClassLabel(classLabel === option.label ? "" : option.label)
            }
            className={chip({ on: classLabel === option.label })}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* -------------------------------------------------------- tap two */}
      {classLabel ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-3">
          {templates.map((option) => (
            <button
              key={option.name}
              type="button"
              onClick={() =>
                setTemplate(template?.name === option.name ? null : option)
              }
              className={chip({ on: template?.name === option.name })}
            >
              {option.name}
            </button>
          ))}
        </div>
      ) : null}

      {/* ------------------------------------------------------ tap three */}
      {classLabel && template ? (
        <div className="mt-3 border-t border-[var(--color-border)] pt-3">
          {needsBuilder ? (
            <>
              <p className="mb-2 text-sm text-[var(--color-warning)]">
                {choice.kind !== "one"
                  ? choice.message
                  : teacher && !hasPhone(teacher.phone)
                    ? `No number is saved for ${teacher.name}. Type one in the builder.`
                    : "Marks need a period, so this one goes through the builder."}
              </p>
              <Link
                href={builderHref}
                className={`${btn({ full: true })} border-[var(--color-brand-600)] text-[var(--color-brand-700)]`}
              >
                Choose in the builder →
              </Link>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void send()}
                disabled={busy}
                className={btn({ tone: "go", full: true })}
              >
                {busy
                  ? "Creating…"
                  : `Send ${template.name} to ${teacher!.name}`}
              </button>
              <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
                {teacher!.name} · {teacher!.phone} · due in 5 days ·{" "}
                <Link href={builderHref} className="underline">
                  change anything
                </Link>
              </p>
            </>
          )}
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-[var(--radius-control)] border border-[var(--color-danger)] bg-[var(--color-danger-bg)] px-4 py-3 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** The same five days the full builder defaults to. */
function plusFiveDays(): string {
  const date = new Date();
  date.setDate(date.getDate() + 5);
  return date.toISOString().slice(0, 10);
}
