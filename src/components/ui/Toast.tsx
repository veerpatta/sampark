"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

/**
 * Toasts, and the undo that goes with them.
 *
 * The point is to replace confirmation dialogs, not to decorate. A modal asking
 * "are you sure?" is a question the office cannot answer — she has not done the
 * thing yet, so she has nothing to look at, and she will guess. Doing it and
 * offering to put it back gives her the answer first and the decision second.
 *
 * Bottom of the screen on a phone, because that is where a thumb is and where
 * she is already looking. Top right on a desktop, out of the way of the table
 * she is reading.
 *
 * Undo is only offered where it is TRUE. Approving a change into the master
 * record has no clean inverse, so that one says what happened and stops. A
 * button labelled Undo that does not undo is worse than no button.
 */

export type ToastTone = "info" | "success" | "danger";

export type ToastInput = {
  message: string;
  /** Omit when the action genuinely cannot be reversed. */
  undo?: () => void | Promise<void>;
  /** Label for the undo button. Hindi on the teacher surface. */
  undoLabel?: string;
  tone?: ToastTone;
  /** Milliseconds. Long enough to read, short enough not to nag. */
  duration?: number;
};

type Toast = ToastInput & { id: number };

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

/**
 * Throws rather than no-ops when the provider is missing. A toast that silently
 * fails to appear is a mutation the user is never told about.
 */
export function useToast(): (toast: ToastInput) => void {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast used outside <ToastProvider>");
  return show;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    // One at a time. Two stacked toasts on a 390px screen cover the thing they
    // are describing, and the older one is always the less relevant.
    setToasts([{ ...input, id }]);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      // aria-live rather than role="alert": these announce completed work, not
      // errors, and should not interrupt what she is reading.
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:inset-x-auto md:bottom-auto md:right-4 md:top-4 md:items-end md:pb-4"
    >
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  );
}

function ToastRow({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  const { id, message, undo, undoLabel = "Undo", tone = "info" } = toast;
  const duration = toast.duration ?? (undo ? 8000 : 4000);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    // Start fading a beat before it actually goes, so it does not blink out.
    const fade = setTimeout(() => setLeaving(true), Math.max(0, duration - 200));
    const gone = setTimeout(() => onDismiss(id), duration);
    return () => {
      clearTimeout(fade);
      clearTimeout(gone);
    };
  }, [id, duration, onDismiss]);

  const border = {
    info: "border-[var(--color-border)]",
    success: "border-[var(--color-confirm-border)]",
    danger: "border-[var(--color-danger)]",
  }[tone];

  return (
    // Comes up from the bottom on a phone, where her thumb and her eyes are;
    // in from the right on a desktop, away from the table she is reading. Both
    // keyframes are neutralised by the prefers-reduced-motion rule in
    // globals.css, which is the whole reason these are CSS and not JS.
    <div
      className={`pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-[var(--radius-card)] border ${border} bg-[var(--color-surface)] px-4 py-3 text-sm shadow-lg transition-opacity duration-200 ${
        leaving ? "opacity-0" : "animate-[toast-in_220ms_ease-out]"
      }`}
    >
      <span className="flex-1">{message}</span>
      {undo ? (
        <button
          type="button"
          onClick={() => {
            void undo();
            onDismiss(id);
          }}
          className="min-h-[var(--tap-min)] shrink-0 px-2 font-semibold text-[var(--color-brand-600)] underline underline-offset-2"
        >
          {undoLabel}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onDismiss(id)}
          aria-label="Dismiss"
          className="min-h-[var(--tap-min)] shrink-0 px-2 text-[var(--color-ink-muted)]"
        >
          ×
        </button>
      )}
    </div>
  );
}
