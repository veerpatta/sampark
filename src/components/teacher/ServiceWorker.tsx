"use client";

import { useEffect } from "react";

/**
 * Registers the service worker, from the teacher surface only.
 *
 * Mounted on /r/[token] rather than in the root layout because the admin
 * console has no offline story and does not want its navigations intercepted.
 * The worker itself also ignores everything outside /r/* and /_next/static/*,
 * so this is belt and braces.
 *
 * Failure is silent on purpose: no service worker means no offline page, which
 * is a worse experience but a working one. An error toast about a caching layer
 * would mean nothing to a class teacher.
 */
export function ServiceWorker() {
  useEffect(() => {
    // A development worker can keep an older client bundle alive while the
    // server renders fresh code, producing misleading hydration failures.
    // Offline behavior is verified from production builds instead.
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    // Registering over http on anything but localhost is refused by the
    // browser, so this quietly does nothing in that case.
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
