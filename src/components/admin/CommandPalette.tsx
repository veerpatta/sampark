"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { field } from "@/components/ui/controls";
import type { SearchHit } from "@/lib/search";

/**
 * One box, from anywhere: a child, a request, a screen.
 *
 * NOT A MODAL. The repo has none (AddQuestion.tsx says why), and a search box
 * does not need one: it is an anchored panel under the header, full width on
 * a phone, a column on a desktop, closed by Escape, by tapping outside, or by
 * going somewhere. Every hit is a real <Link>, so Enter on the highlighted
 * one is a navigation the browser understands and Next prefetches.
 *
 * Ctrl/⌘+K opens it on a keyboard. On a phone the magnifier in the app bar
 * is the only way in, which is fine — the phone has no K.
 */
const KIND_WORD: Record<SearchHit["kind"], string> = {
  student: "student",
  request: "request",
  page: "go to",
};

export function CommandPalette({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const links = useRef<(HTMLAnchorElement | null)[]>([]);
  const router = useRouter();
  const pathname = usePathname();

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHits([]);
    setActive(0);
  }, []);

  // Route change closes it: a hit was taken.
  useEffect(() => {
    close();
  }, [pathname, close]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    function onPointer(event: PointerEvent) {
      if (panel.current && !panel.current.contains(event.target as Node)) close();
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open, close]);

  // Debounced, and abortable: a slow answer to "ra" must not land after the
  // answer to "ravi".
  useEffect(() => {
    if (!open) return;
    const needle = query.trim();
    if (needle.length < 2) {
      setHits([]);
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setBusy(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(needle)}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const body = (await response.json()) as { hits: SearchHit[] };
        setHits(body.hits);
        setActive(0);
      } catch {
        // Aborted or offline; the previous list stands.
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 150);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, open]);

  function onInputKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(hits.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter") {
      const hit = hits[active];
      if (hit) {
        event.preventDefault();
        router.push(hit.href);
        close();
      }
    }
  }

  return (
    <div ref={panel} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label="Search"
        className={
          compact
            ? "flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-ink-muted)]"
            : "inline-flex h-9 items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-ink-muted)] hover:border-[var(--color-brand-600)] lg:px-3"
        }
      >
        <MagnifyingGlass aria-hidden size={compact ? 22 : 16} />
        {/*
          THE LABEL IS THE FIRST THING TO GO. At exactly the `md` breakpoint the
          header row is 720px of content in a 720px box, and "Search ⌘K" was the
          85px that pushed every page 32px sideways — on the one width where the
          desktop layout has least room. The icon alone is still a search box,
          and the shortcut it names works whether or not it is written down.
        */}
        {compact ? null : (
          <>
            <span className="hidden lg:inline">Search</span>
            <kbd className="hidden rounded bg-[var(--color-surface-muted)] px-1.5 font-mono text-[11px] lg:inline">
              ⌘K
            </kbd>
          </>
        )}
      </button>

      {open ? (
        <div
          className={`absolute z-50 mt-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-raised)] ${
            compact ? "fixed inset-x-2 top-[calc(var(--app-bar-h)+0.25rem)] mt-0" : "right-0 w-[28rem] max-w-[90vw]"
          }`}
        >
          <input
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKey}
            placeholder="Name, ID, mobile, request, or a screen…"
            aria-label="Search"
            autoComplete="off"
            className={field()}
          />
          <ul className="mt-2 max-h-[60vh] overflow-y-auto" role="listbox">
            {hits.map((hit, index) => (
              <li key={`${hit.kind}:${hit.href}`} role="option" aria-selected={index === active}>
                <Link
                  href={hit.href}
                  ref={(element) => {
                    links.current[index] = element;
                  }}
                  onMouseEnter={() => setActive(index)}
                  onClick={close}
                  className={`flex items-baseline gap-3 rounded-[var(--radius-control)] px-3 py-2 text-sm ${
                    index === active ? "bg-[var(--color-brand-50)]" : ""
                  }`}
                >
                  <span className="w-14 shrink-0 text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">
                    {KIND_WORD[hit.kind]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{hit.title}</span>
                    {hit.detail ? (
                      <span className="block truncate text-xs text-[var(--color-ink-muted)]">{hit.detail}</span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
            {query.trim().length >= 2 && hits.length === 0 && !busy ? (
              <li className="px-3 py-2 text-sm text-[var(--color-ink-muted)]">Nothing matches.</li>
            ) : null}
            {query.trim().length < 2 ? (
              <li className="px-3 py-2 text-xs text-[var(--color-ink-muted)]">
                Type two or more characters. ↑ ↓ to move, Enter to open, Esc to close.
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
