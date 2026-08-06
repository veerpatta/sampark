/**
 * One short buzz when an answer lands.
 *
 * On an Android phone this single haptic does more for "the app responded to
 * me" than any amount of colour, because it is felt rather than looked for —
 * her eyes are on the paper register, not the screen. Feature-detected, and a
 * no-op on iOS, which has no equivalent from the web.
 *
 * Ten milliseconds is a tick, not a buzz. Anything longer reads as an error.
 *
 * Fired ONCE per action, including for a bulk confirm — forty buzzes for one
 * tap would be a fault, not feedback.
 */
export function tick(): void {
  if (typeof navigator === "undefined") return;
  navigator.vibrate?.(10);
}
