import { useEffect, useState } from 'react'
import { Icon } from '../ui/Icon'
import { listNotices } from '../../lib/api/program'
import type { ProgramNotice } from '../../lib/program'
import { momentLabel } from '../../lib/report'
import { ClampedText } from '../ui/ClampedText'
import { AnnouncementDialog } from '../classes/AnnouncementDialog'

const SHOWN = 2

/**
 * What the program office has said.
 *
 * A notice stays here until the chair takes it down. A pinned notice sits at
 * the top; the rest fold away behind a line, and each one is shown shortened
 * with a "See more" that opens the whole of it. Nothing here is dismissible per
 * person — what is on this list is current for everyone.
 */
export function ProgramNotices() {
  const [rows, setRows] = useState<ProgramNotice[]>([])
  const [all, setAll] = useState(false)
  const [viewing, setViewing] = useState<ProgramNotice | null>(null)

  useEffect(() => {
    void listNotices()
      .then(setRows)
      .catch(() => setRows([]))
  }, [])

  if (rows.length === 0) return null

  const shown = all ? rows : rows.slice(0, SHOWN)

  return (
    <section className="space-y-2">
      <p className="eyebrow text-faint">From the program office</p>
      <ul className="space-y-2">
        {shown.map((n) => (
          <li
            key={n.id}
            className={`surface rounded-card border p-4 shadow-card ${
              n.pinned ? 'border-warning-300 dark:border-warning-400/40' : 'border-line'
            }`}
          >
            <h3 className="flex items-center gap-2 text-ink">
              {n.pinned && <Icon name="pin" size={14} className="shrink-0 text-warning-500" />}
              {n.title}
            </h3>
            <ClampedText
              text={n.body}
              lines={3}
              className="mt-1.5 max-w-[80ch] text-[13px] leading-relaxed text-muted"
              onSeeMore={() => setViewing(n)}
            />
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

      <AnnouncementDialog
        view={
          viewing && {
            eyebrow: 'Program office',
            title: viewing.title,
            body: viewing.body,
            pinned: viewing.pinned,
            authorName: viewing.author_name,
            authorAvatar: viewing.author_avatar,
            when: momentLabel(viewing.created_at),
            edited: Boolean(viewing.edited_at),
          }
        }
        onClose={() => setViewing(null)}
      />
    </section>
  )
}
