import type { ReactNode } from 'react'

/**
 * The few shapes every page is built from, so a reader learns them once.
 *
 *   Stats   a row of tiles: figure, a label of a few words, a small dated line
 *   Table   a real table, with a header on a wide screen and labelled cards on
 *           a narrow one; a row can open a detail
 *   Chip    a state in three words or fewer
 *   Method  the one place per page where the method lives, closed by default
 *   Links   a line of small links, never a block
 */

export interface StatItem {
  /** The figure, already formatted. */
  value: ReactNode
  /** Five words at most. */
  label: string
  /** A date or a sample size; small and muted. */
  note?: string | null
  href?: string
  /** Emphasis for the one figure the page is about. */
  lead?: boolean
  /** A permanent anchor, so a figure can be cited by URL. */
  id?: string
}

export function Stats({ items, ariaLabel = 'Key figures' }: { items: StatItem[]; ariaLabel?: string }) {
  return (
    <ul className="stats" aria-label={ariaLabel}>
      {items.map((item, index) => {
        const body = (
          <>
            <span className="stat-v">{item.value}</span>
            <span className="stat-k">{item.label}</span>
            {item.note ? <span className="stat-n">{item.note}</span> : null}
          </>
        )
        return (
          <li key={index} id={item.id} className={item.lead ? 'lead' : undefined}>
            {item.href ? <a href={item.href}>{body}</a> : body}
          </li>
        )
      })}
    </ul>
  )
}

export interface TableColumn {
  key: string
  label: string
  /** The label on a narrow screen, where the column is a small caption over the value. */
  short?: string
  align?: 'left' | 'right'
  /** The first column: name and sub-line, never labelled on a card. */
  primary?: boolean
  /** Numbers: tabular figures. */
  numeric?: boolean
}

export interface TableRow {
  key: string
  cells: Record<string, ReactNode>
  /** Shown under the row, closed, on request. */
  detail?: ReactNode
  detailLabel?: string
  /** Data attributes for the client-side filters and sorts, as { name: value }. */
  data?: Record<string, string | number>
}

export function Table({
  cols,
  rows,
  caption,
  id,
  className,
  empty = 'Nothing yet.',
}: {
  cols: TableColumn[]
  rows: TableRow[]
  caption: string
  id?: string
  className?: string
  empty?: string
}) {
  if (rows.length === 0) return <p className="empty">{empty}</p>
  return (
    <div className="tbl-wrap">
      <table className={`tbl${className ? ` ${className}` : ''}`} id={id}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {cols.map((col) => (
              <th key={col.key} scope="col" className={col.align === 'right' ? 'r' : undefined}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const attrs = Object.fromEntries(Object.entries(row.data ?? {}).map(([k, v]) => [`data-${k}`, String(v)]))
            return (
              <tr key={row.key} {...attrs}>
                {cols.map((col) => (
                  <td
                    key={col.key}
                    data-label={col.primary ? undefined : (col.short ?? col.label)}
                    className={[col.primary ? 'primary' : '', col.align === 'right' ? 'r' : '', col.numeric ? 'num' : ''].filter(Boolean).join(' ') || undefined}
                  >
                    {col.primary && row.detail ? (
                      <details className="row-detail">
                        <summary>{row.cells[col.key]}</summary>
                        <div className="row-detail-body">{row.detail}</div>
                      </details>
                    ) : (
                      row.cells[col.key]
                    )}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export type ChipTone = 'on' | 'warn' | 'off' | 'plain'

export function Chip({ tone = 'plain', children }: { tone?: ChipTone; children: ReactNode }) {
  return <span className={`chip ${tone}`}>{children}</span>
}

export function Method({ title = 'How this is measured', children }: { title?: string; children: ReactNode }) {
  return (
    <details className="method">
      <summary>{title}</summary>
      <div className="method-body">{children}</div>
    </details>
  )
}

export function Links({ children, ariaLabel }: { children: ReactNode; ariaLabel?: string }) {
  return (
    <p className="links-row" aria-label={ariaLabel}>
      {children}
    </p>
  )
}

/** A section with a short title and, optionally, one sentence. */
export function Section({
  id,
  title,
  line,
  children,
  tight,
}: {
  id: string
  title: string
  line?: ReactNode
  children: ReactNode
  tight?: boolean
}) {
  return (
    <section className={`sec${tight ? ' tight' : ''}`} id={id} aria-labelledby={`${id}-title`}>
      <div className="wrap">
        <div className="sec-head">
          <h2 id={`${id}-title`}>{title}</h2>
          {line ? <p className="sec-line">{line}</p> : null}
        </div>
        {children}
      </div>
    </section>
  )
}
