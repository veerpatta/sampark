/* eslint-disable @next/next/no-img-element */
import { THUMB_SUFFIX } from "@/lib/photos";

/**
 * A child's face, in the office console.
 *
 * Plain `<img>` throughout, deliberately. next/image would route these through
 * Vercel's image optimiser, which means caching photographs of children on a
 * CDN outside the session check that /api/photos exists to enforce. The whole
 * point of the proxy is that every single read re-checks who is asking.
 *
 * Sizes come from the call site because the three places this appears want
 * genuinely different ones: 32px in a list of a hundred, 96px on a detail page,
 * 120px in the review queue where the decision is being made.
 */

/** The office proxy. Session-checked on every request — see /api/photos. */
export function photoSrc(pathname: string, size: "full" | "thumb" = "full") {
  const path =
    size === "thumb" ? pathname.replace(/\.jpg$/, `${THUMB_SUFFIX}.jpg`) : pathname;
  return `/api/photos?p=${encodeURIComponent(path)}`;
}

export function StudentPhoto({
  pathname,
  name,
  className = "h-8 w-8",
  size = "thumb",
}: {
  pathname: string | null;
  name: string;
  className?: string;
  size?: "full" | "thumb";
}) {
  if (!pathname) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)] ${className}`}
        aria-hidden
      >
        —
      </span>
    );
  }

  return (
    <img
      src={photoSrc(pathname, size)}
      alt={name}
      // Lazy on purpose: a hundred faces is a hundred authenticated round trips
      // and most of them are below the fold. The thumbnail variant keeps each
      // one at about 4 kB rather than 100.
      loading="lazy"
      decoding="async"
      className={`shrink-0 rounded-full border border-[var(--color-border)] object-cover ${className}`}
    />
  );
}

/**
 * What the office is actually deciding: is the new face the right child?
 *
 * Both images at a size a face is recognisable at. The old one dimmed, because
 * approving replaces it — and when there was no old one, saying so in words is
 * clearer than an empty box that could be a broken image.
 */
export function PhotoDiff({
  before,
  after,
  name,
}: {
  before: string | null;
  after: string | null;
  name: string;
}) {
  return (
    <span className="flex flex-wrap items-end gap-3">
      {before ? (
        <span className="opacity-50">
          <img
            src={photoSrc(before)}
            alt={`${name} — previous photo`}
            loading="lazy"
            className="h-28 w-28 rounded-[var(--radius-card)] border border-[var(--color-border)] object-cover"
          />
        </span>
      ) : (
        <span className="text-meta text-[var(--color-ink-muted)]">
          no photo on record
        </span>
      )}

      <span aria-hidden className="pb-2 text-[var(--color-ink-muted)]">
        →
      </span>

      {after ? (
        <img
          src={photoSrc(after)}
          alt={`${name} — new photo`}
          loading="lazy"
          className="h-28 w-28 rounded-[var(--radius-card)] border-2 border-[var(--color-brand-500)] object-cover"
        />
      ) : (
        <span className="text-meta text-[var(--color-ink-muted)]">nothing</span>
      )}
    </span>
  );
}
