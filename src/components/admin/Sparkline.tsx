/**
 * A trend in the space of a word.
 *
 * Inline SVG on the server, no library — globals.css records why a chart or
 * animation dependency is not worth its place in the shared bundle. It answers
 * one question, "is this going up", and draws nothing else: no axes, no grid,
 * no legend. The last point is marked, because "where is it now" is the second
 * question.
 */
export function Sparkline({
  points,
  width = 120,
  height = 28,
  label,
  className = "",
}: {
  /** Percentages, oldest first. */
  points: number[];
  width?: number;
  height?: number;
  label: string;
  className?: string;
}) {
  if (points.length < 2) {
    return (
      <span className={`text-xs text-[var(--color-ink-faint)] ${className}`}>
        {points.length === 1 ? "one day of history" : "no history yet"}
      </span>
    );
  }

  const pad = 3;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = points[points.length - 1]!;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
      className={`shrink-0 overflow-visible ${className}`}
    >
      <title>{label}</title>
      <path d={path} fill="none" stroke="var(--color-brand-600)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(last)} r="2.5" fill="var(--color-brand-600)" />
    </svg>
  );
}
