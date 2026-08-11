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
 *
 * SEPARATE CARDS ON A PHONE, ONE FRAME ON A DESKTOP. The rows used to be
 * divided lines inside a single bordered box at both widths, which is right for
 * a table — the frame is the table — and wrong for a stack, where the frame is
 * a second border wrapped around content that already has edges. Each row is
 * one record you act on, so each gets its own card.
 *
 * `card` is the escape hatch for the three boards whose phone row is not a
 * title over some labelled values: a student is a face, a name and a
 * completeness bar; a request is an audience over a run of mono metadata. The
 * generic assembly stays the default so no board has to opt in to it.
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

/**
 * Row selection, for the bulk bar.
 *
 * A plain checkbox with a name and a value, so the selection is ordinary form
 * state and this component stays a server component — its `columns` carry
 * render functions and could never cross to the client anyway.
 *
 * On a card the checkbox sits OUTSIDE the link rather than in it. A checkbox
 * nested inside an anchor is invalid, and in practice the tap either navigates
 * or ticks depending on which pixel the thumb lands on.
 */
export type Selection<T> = {
  /** Form field name. Every row shares it; the action reads getAll(). */
  name: string;
  value: (row: T) => string;
  /** Rows the bulk action cannot act on. Rendered without a checkbox. */
  disabled?: (row: T) => boolean;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  href,
  empty,
  select,
  card: renderCard,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** When given, the whole card is a link and the primary cell is too. */
  href?: (row: T) => string;
  empty?: React.ReactNode;
  select?: Selection<T>;
  /**
   * The phone card's body, when the generic title/subtitle/values assembly is
   * not what this board's row is. Never affects the table at md and up — the
   * columns are still the single source of truth for that.
   */
  card?: (row: T) => React.ReactNode;
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
    <div className="md:overflow-hidden md:rounded-[var(--radius-card)] md:border md:border-[var(--color-border)] md:bg-[var(--color-surface)] md:shadow-card">
      {/* ------------------------------------------------------ md and up */}
      <table className="hidden w-full text-sm md:table">
        <thead className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">
          <tr>
            {select ? <th className="w-10 px-4 py-3" /> : null}
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
              {select ? (
                <td className="px-4 py-3">
                  {select.disabled?.(row) ? null : (
                    <input
                      type="checkbox"
                      name={select.name}
                      value={select.value(row)}
                      className="h-5 w-5"
                      aria-label="Select this row"
                    />
                  )}
                </td>
              ) : null}
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
      <ul className="flex flex-col gap-2.5 md:hidden">
        {rows.map((row) => {
          const contents = renderCard ? (
            renderCard(row)
          ) : (
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

          const body = href ? (
            // The whole card is the target, not a link buried in it —
            // a 48px-tall card is a better tap target than six words.
            <Link
              href={href(row)}
              className="block px-4 py-3.5 active:bg-[var(--color-surface-muted)]"
            >
              {contents}
            </Link>
          ) : (
            <div className="px-4 py-3.5">{contents}</div>
          );

          const shell =
            "overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card";

          if (!select) {
            return (
              <li key={rowKey(row)} className={shell}>
                {body}
              </li>
            );
          }

          return (
            <li key={rowKey(row)} className={`flex items-start ${shell}`}>
              <span className="flex min-h-[var(--tap-min)] shrink-0 items-center pl-4 pt-3.5">
                {select.disabled?.(row) ? (
                  <span className="h-5 w-5" />
                ) : (
                  <input
                    type="checkbox"
                    name={select.name}
                    value={select.value(row)}
                    className="h-5 w-5"
                    aria-label="Select this row"
                  />
                )}
              </span>
              <div className="min-w-0 flex-1">{body}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
