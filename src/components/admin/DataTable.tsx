import Link from "next/link";

/**
 * A board that is a table on a desktop and a stack of cards on a phone.
 *
 * A horizontally scrolling seven-column table on a 390px screen is a defeat:
 * the columns that matter are off the right edge, and finding them costs a
 * gesture that competes with the browser's back swipe. Below `md` each row
 * becomes a card — the primary column is its title, the secondary its
 * subtitle, and the rest are label/value pairs that wrap.
 *
 * One component rather than ten copies of the breakpoint logic, and the
 * loading skeleton uses the same two-shape structure so what appears while
 * waiting matches what arrives.
 */
export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  /**
   * primary   — the card's title. Exactly one per table.
   * secondary — the card's subtitle, under the title.
   * meta      — a labelled value in the card's body. The default.
   */
  role?: "primary" | "secondary" | "meta";
  /** Present in the table, omitted from the card to keep it readable. */
  hideOnCard?: boolean;
  /** Extra classes for the table cell only. */
  cellClassName?: string;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  href,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** When given, the whole card is a link and the primary cell is too. */
  href?: (row: T) => string;
  empty?: React.ReactNode;
}) {
  if (rows.length === 0 && empty) {
    return (
      <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-ink-muted)]">
        {empty}
      </p>
    );
  }

  const primary = columns.find((column) => column.role === "primary");
  const secondary = columns.filter((column) => column.role === "secondary");
  // `!column.role` used to short-circuit before hideOnCard was read, so the flag
  // did nothing on exactly the columns that set it — a column with no role is
  // the normal way to declare one. It matters now: a card that is itself a link
  // must not contain a second link, and hideOnCard is how such a column opts
  // out of the card.
  const meta = columns.filter(
    (column) =>
      (!column.role || column.role === "meta") && !column.hideOnCard,
  );

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card">
      {/* ------------------------------------------------------ md and up */}
      <table className="hidden w-full text-sm md:table">
        <thead className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className="px-4 py-3 font-medium">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-[var(--color-border)] last:border-0"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-4 py-3 ${column.cellClassName ?? ""}`}
                >
                  {/* The link lives HERE rather than in the column's cell, so a
                      column never owns an anchor of its own. On a phone the
                      whole card is already a link, and a cell that returned one
                      too would nest anchors — invalid, and it swallows the tap
                      it happens to land on. */}
                  {href && column.role === "primary" ? (
                    <Link
                      href={href(row)}
                      className="font-medium text-[var(--color-brand-600)] hover:underline"
                    >
                      {column.cell(row)}
                    </Link>
                  ) : (
                    column.cell(row)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* ------------------------------------------------------ below md */}
      <ul className="divide-y divide-[var(--color-border)] md:hidden">
        {rows.map((row) => {
          const card = (
            <>
              {primary ? (
                <div className="font-medium">{primary.cell(row)}</div>
              ) : null}
              {secondary.map((column) => (
                <div
                  key={column.key}
                  className="mt-0.5 text-sm text-[var(--color-ink-muted)]"
                >
                  {column.cell(row)}
                </div>
              ))}
              {meta.length > 0 ? (
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  {meta.map((column) => (
                    <div key={column.key}>
                      <dt className="text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">
                        {column.header}
                      </dt>
                      <dd className="mt-0.5">{column.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </>
          );

          return (
            <li key={rowKey(row)}>
              {href ? (
                // The whole card is the target, not a link buried in it —
                // a 48px-tall card is a better tap target than six words.
                <Link
                  href={href(row)}
                  className="block px-4 py-4 active:bg-[var(--color-surface-muted)]"
                >
                  {card}
                </Link>
              ) : (
                <div className="px-4 py-4">{card}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
