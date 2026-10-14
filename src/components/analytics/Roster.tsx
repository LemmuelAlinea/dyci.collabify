import { useState } from 'react'
import { Sparkline } from '../charts/Sparkline'
import { TONE_CELL } from '../charts/format'
import { FLAG_META, entryKey } from './flags'
import type { RosterEntry } from './flags'

type Key = 'name' | 'groups' | 'share' | 'done' | 'late' | 'hours' | 'comments' | 'idle' | 'flags'

const value = (e: RosterEntry, k: Key): number | string => {
  switch (k) {
    case 'name': return e.student_name
    case 'groups': return e.groups.join(', ')
    case 'share': return e.lowestShare ?? 101
    case 'done': return e.held ? e.done / e.held : -1
    case 'late': return e.done ? e.late / e.done : -1
    case 'hours': return e.worklog_minutes
    case 'comments': return e.comments
    case 'idle': return e.idle ?? 9999
    case 'flags': return e.flags.length
  }
}

const HEADS: { key: Key; label: string }[] = [
  { key: 'name', label: 'Student' },
  { key: 'groups', label: 'Groups' },
  { key: 'share', label: 'Share of group work' },
  { key: 'done', label: 'Finished' },
  { key: 'late', label: 'Late' },
  { key: 'hours', label: 'Logged' },
  { key: 'comments', label: 'Comments' },
  { key: 'idle', label: 'Last active' },
  { key: 'flags', label: 'Flags' },
]

/** Every student, sortable on every column. Flags first by default, so the people to talk to lead. */
export function Roster({ entries, onOpen }: { entries: RosterEntry[]; onOpen: (id: string) => void }) {
  const [sort, setSort] = useState<{ key: Key; desc: boolean }>({ key: 'flags', desc: true })
  const rows = [...entries].sort((a, b) => {
    // Students with no share to show sit last whichever way the column runs.
    if (sort.key === 'share' && (a.lowestShare === null) !== (b.lowestShare === null)) return a.lowestShare === null ? 1 : -1
    const va = value(a, sort.key)
    const vb = value(b, sort.key)
    const c = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number)
    return (sort.desc ? -c : c) || a.student_name.localeCompare(b.student_name)
  })

  if (entries.length === 0) {
    return <p className="text-[13px] text-muted">No active students in view.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] text-[13px]">
        <caption className="sr-only">Students and the evidence of their work</caption>
        <thead>
          <tr className="border-b border-line text-left">
            {HEADS.map((h) => (
              <th key={h.key} scope="col" aria-sort={sort.key === h.key ? (sort.desc ? 'descending' : 'ascending') : 'none'} className="px-2 py-2 font-medium">
                <button
                  type="button"
                  onClick={() => setSort((s) => ({ key: h.key, desc: s.key === h.key ? !s.desc : h.key !== 'name' && h.key !== 'groups' && h.key !== 'share' }))}
                  className="text-[12px] text-faint hover:text-ink"
                >
                  {h.label}
                  {sort.key === h.key && <span aria-hidden> {sort.desc ? '↓' : '↑'}</span>}
                </button>
              </th>
            ))}
            <th scope="col" className="px-2 py-2 text-[12px] font-medium text-faint">8 weeks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={entryKey(e)} id={`attn-student-${entryKey(e)}`} className="border-b border-line last:border-0 hover:bg-[var(--surface-sunken)]">
              <th scope="row" className="px-2 py-2 text-left font-normal">
                <button type="button" onClick={() => onOpen(entryKey(e))} className="flex items-center gap-2 text-ink hover:underline">
                  {e.avatar_url ? (
                    <img src={e.avatar_url} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full surface-sunken text-[10px] text-muted">
                      {e.student_name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  {e.student_name}
                </button>
              </th>
              <td className="px-2 py-2 text-muted">{e.groups.length ? e.groups.join(', ') : '—'}</td>
              <td className="px-2 py-2 font-mono text-muted">{e.lowestShare === null ? '—' : `${Math.round(e.lowestShare)}%`}</td>
              <td className="px-2 py-2 font-mono text-muted">{e.done} / {e.held}</td>
              <td className="px-2 py-2 font-mono text-muted">{e.done ? `${Math.round((e.late / e.done) * 100)}%` : '—'}</td>
              <td className="px-2 py-2 font-mono text-muted">{(e.worklog_minutes / 60).toFixed(1)}h</td>
              <td className="px-2 py-2 font-mono text-muted">{e.comments}</td>
              <td className="px-2 py-2 font-mono text-muted">{e.idle === null ? 'Never' : e.idle === 0 ? 'Today' : `${e.idle}d ago`}</td>
              <td className="px-2 py-2">
                <span className="flex flex-wrap gap-1">
                  {e.flags.map((f) => (
                    <span key={f} className={`rounded-md px-1.5 py-0.5 text-[11px] ${TONE_CELL[FLAG_META[f].tone]}`}>
                      {FLAG_META[f].word(e)}
                    </span>
                  ))}
                </span>
              </td>
              <td className="px-2 py-2">
                <Sparkline values={e.trend} label={`${e.student_name}: actions per week for 8 weeks, latest ${e.trend[e.trend.length - 1]}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
