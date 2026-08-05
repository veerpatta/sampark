/**
 * Devanagari digits for counts the teacher reads at a glance.
 *
 * Applied to counts and progress only — never to a phone number, an Aadhaar
 * number or a mark. Those are data she is checking against a paper register or
 * typing from a parent's message, and they must appear exactly as they are
 * stored.
 */
export function toHindiDigits(value: number | string): string {
  return String(value).replace(/\d/g, (digit) => "०१२३४५६७८९"[Number(digit)]!);
}
