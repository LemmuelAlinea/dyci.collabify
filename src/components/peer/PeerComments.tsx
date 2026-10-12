import { useEffect, useState } from 'react'
import { peerComments } from '../../lib/api/peer'
import type { PeerComment } from '../../lib/types'

/**
 * What teammates wrote, grouped by who it is about. Rater names stay hidden until
 * asked for, so a professor reads the substance before the source.
 */
export function PeerComments({ roundId, boardId, revision }: { roundId: string; boardId: string; revision: number }) {
  const [rows, setRows] = useState<PeerComment[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [showRaters, setShowRaters] = useState(false)

  // A different round or group starts empty. A revision bump refetches in place,
  // so the list stays up while it reloads.
  useEffect(() => {
    setRows(null)
    setFailed(false)
  }, [roundId, boardId])

  useEffect(() => {
    let live = true
    peerComments(roundId)
      .then((all) => {
        if (!live) return
        setRows(all.filter((c) => c.board_id === boardId))
        setFailed(false)
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [roundId, boardId, revision])

  if (failed) {
    return (
      <p className="text-[12px] text-danger-700 dark:text-danger-300">
        Could not load the comments. Reload the page to try again.
      </p>
    )
  }
  if (rows === null) return null
  if (rows.length === 0) return <p className="text-[12px] text-faint">No written comments.</p>

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-medium text-muted">Comments ({rows.length})</p>
        <button
          type="button"
          onClick={() => setShowRaters((v) => !v)}
          className="text-[12px] font-medium text-navy-600 hover:underline dark:text-navy-200"
        >
          {showRaters ? 'Hide raters' : 'Show raters'}
        </button>
      </div>
      <ul className="space-y-1.5">
        {rows.map((c) => (
          <li key={`${c.rater_id}-${c.ratee_id}`} className="rounded-lg surface-sunken px-3 py-2 text-[13px]">
            <span className="text-faint">About {c.ratee_name}{showRaters && `, from ${c.rater_name}`}: </span>
            <span className="text-ink">{c.comment}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
