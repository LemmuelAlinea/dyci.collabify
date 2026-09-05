import { useEffect, useState } from 'react'
import { Icon } from '../ui/Icon'
import { listNotices } from '../../lib/api/program'
import type { ProgramNotice } from '../../lib/program'
import { momentLabel } from '../../lib/report'

const SHOWN = 2

/**
 * What the program office has said in the last 24 hours.
 *
 * The window is the view's, not this component's — `program_notices` stops at
 * it, so there is no page anywhere that can show a stale one. That also means
 * this list empties itself: a notice nobody took down still leaves, and the
 * section disappears with the last of them.
 *
 * A pinned notice sits at the top of whatever is inside the window; the rest
 * fold away behind a line, because a dashboard that opens on six announcements
 * is a dashboard nobody reads. Nothing here is dismissible per person — what is
 * on this list is current for everyone.
 */
export function ProgramNotices() {
  const [rows, setRows] = useState<ProgramNotice[]>([])
  const [all, setAll] = useState(false)

  useEffect(() => {
    void listNotices()
      .then(setRows)
      .catch(() => setRows([]))
  }, [])

  if (rows.length === 0) return null

  const shown = all ? rows : rows.slice(0, SHOWN)

  return (
    <section className="space-y-2">
      <p className="eyebrow text-faint">From the program office · last 24 hours</p>
      <ul className="space-y-2">
        {shown.map((n) => (
          <li
            key={n.id}
            className={`surface rounded-card border p-4 shadow-card ${
              n.pinned ? 'border-amber-300 dark:border-amber-400/40' : 'border-line'
            }`}
          >
            <h3 className="flex items-center gap-2 text-ink">
              {n.pinned && <Icon name="pin" size={14} className="shrink-0 text-amber-500" />}
              {n.title}
            </h3>
            <p className="mt-1.5 max-w-[80ch] text-[13px] leading-relaxed whitespace-pre-wrap text-muted">
              {n.body}
            </p>
            <p className="mt-2 text-[12px] text-faint">
              {n.author_name} · {momentLabel(n.created_at)}
              {n.edited_at && ' · edited'}
            </p>
          </li>
        ))}
      </ul>

      {rows.length > SHOWN && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="text-[12px] font-medium text-navy-600 hover:underline dark:text-navy-200"
        >
          {all ? 'Show fewer' : `Show the other ${rows.length - SHOWN}`}
        </button>
      )}
    </section>
  )
}
