/* eslint-disable @next/next/no-img-element */
import { photoSrc } from "./StudentPhoto";

/**
 * A child in a list, when there may or may not be a photograph of them.
 *
 * StudentPhoto is a circle and falls back to an em dash, which reads as "no
 * value" — correct in a table cell, wrong at the head of a row that is the
 * child. In a list of five hundred, a column of identical grey circles gives
 * the eye nothing to move along; initials give it something, and they are
 * information the app already has rather than an apology for what it does not.
 *
 * A rounded square rather than a circle, deliberately. Roughly two thirds of
 * these are still empty — 212 of 531 students have no photo — and a grid of
 * circles with letters in them reads as a chat app's contact list. The square
 * reads as a record with a picture attached to it, which is what it is.
 *
 * Plain <img> for the same reason StudentPhoto uses one: next/image would put
 * photographs of children on a CDN outside the session check that /api/photos
 * exists to enforce.
 */

const SIZES = {
  /** In a list. */
  row: "h-11 w-11 text-[15px]",
  /** At the head of one student's page. */
  page: "h-[72px] w-[72px] text-xl",
} as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]![0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function Avatar({
  pathname,
  name,
  size = "row",
}: {
  pathname: string | null;
  /** Already title-cased by the call site — names are stored ALL CAPS. */
  name: string;
  size?: keyof typeof SIZES;
}) {
  const box = `${SIZES[size]} shrink-0 rounded-[var(--radius-control)] object-cover`;

  if (!pathname) {
    return (
      <span
        // aria-hidden: the child's name is always right beside this. Read out,
        // the initials are the same name a second time, spelled letter by
        // letter.
        aria-hidden
        className={`${box} flex items-center justify-center bg-[var(--color-surface-sunken)] font-semibold text-[var(--color-ink-faint)]`}
      >
        {initials(name)}
      </span>
    );
  }

  return (
    <img
      src={photoSrc(pathname, "thumb")}
      alt={name}
      loading="lazy"
      decoding="async"
      className={`${box} border border-[var(--color-border)]`}
    />
  );
}
