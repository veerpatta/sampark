"use client";

/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { THUMB_SUFFIX } from "@/lib/photos";

/**
 * A photograph she has already taken, on her own phone.
 *
 * THE TEACHER-SIDE SIBLING OF admin/StudentPhoto, and it exists because the
 * three places a photo's VALUE is rendered on this surface were rendering the
 * blob pathname as text. A collapsed row that said
 * `students/S1001/20260819-3f9c….jpg` where a child's face belonged was the
 * visible half of the reopen bug: she could not tell a photographed child from
 * an unphotographed one without opening every card.
 *
 * Through /api/r/<token>/photo, never the office proxy: that one wants a
 * session, and she has a bearer token and no login. The route authorizes by
 * "is this pathname's child on the frozen roster this token opens", which is
 * exactly the question being asked here.
 *
 * A plain <img>, for the reason StudentPhoto gives — next/image would route a
 * child's photograph through the CDN optimiser, outside the check that decides
 * who may see it.
 */
export function PhotoThumb({
  token,
  pathname,
  name,
  className = "h-12 w-12",
}: {
  token: string;
  pathname: string;
  name: string;
  className?: string;
}) {
  /*
   * THE THUMBNAIL FIRST, THE FULL IMAGE IF THERE ISN'T ONE.
   *
   * A round is forty-six of these on a 2G link: 4 kB each against 100 kB is the
   * difference between a list that renders and one that does not. But the
   * thumbnail is a later addition and a photograph taken before it exists has
   * none — the upload route treats its absence as non-fatal — so falling back
   * is what stops an old photo from rendering as a broken image. Same fallback
   * lib/photo-store.ts documents for the workbook.
   */
  const [full, setFull] = useState(false);
  const wanted = full ? pathname : pathname.replace(/\.jpg$/, `${THUMB_SUFFIX}.jpg`);

  return (
    <img
      src={`/api/r/${token}/photo?p=${encodeURIComponent(wanted)}`}
      alt={name}
      onError={() => setFull(true)}
      // Below the fold on forty of forty-six rows, and each one is an
      // authenticated round trip.
      loading="lazy"
      decoding="async"
      className={`shrink-0 rounded-[var(--radius-card)] border border-[var(--color-border)] object-cover ${className}`}
    />
  );
}
