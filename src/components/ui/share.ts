/**
 * Send a Hindi message, by whatever route this phone actually has.
 *
 * The native share sheet first, because on Android it puts WhatsApp one tap
 * away with the message already in it and the office picks the contact in an
 * interface she uses fifty times a day. wa.me is the fallback and stays the
 * whole story on a desktop.
 *
 * Text only, no `url:` field. Several share targets silently drop `text` when
 * a `url` is present, and the Hindi body is the point — the link is inside it.
 */
export type ShareOutcome = "shared" | "cancelled" | "whatsapp";

export async function shareOrWhatsApp({
  message,
  waUrl,
}: {
  message: string;
  waUrl: string;
}): Promise<ShareOutcome> {
  const payload = { text: message };

  if (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    (navigator.canShare?.(payload) ?? true)
  ) {
    try {
      await navigator.share(payload);
      return "shared";
    } catch (error) {
      // She backed out of the sheet. Opening WhatsApp anyway would be a second
      // app appearing unbidden after she just said no.
      if (error instanceof DOMException && error.name === "AbortError") {
        return "cancelled";
      }
      // Anything else — permission denied, no target, a transient-activation
      // failure because the request took too long to create — falls through.
    }
  }

  // Same-tab navigation rather than window.open: mobile browsers block popups
  // that are not directly inside the tap handler, and by here we may not be.
  window.location.href = waUrl;
  return "whatsapp";
}
