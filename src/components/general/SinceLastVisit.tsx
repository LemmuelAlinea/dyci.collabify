import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { sinceLastVisit } from '../../lib/api/general'
import type { SinceLastVisit as Since } from '../../lib/api/general'
import { paths } from '../../lib/paths'

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * What other people did here while you were away, above the tabs. Says nothing
 * on a first visit or when nothing happened: an empty summary is noise.
 * Closing it hides it until the next time you come back.
 */
export function SinceLastVisit({ projectId }: { projectId: string }) {
  const [data, setData] = useState<Since | null>(null)
  const [closed, setClosed] = useState(false)

  useEffect(() => {
    let live = true
    setData(null)
    setClosed(false)
    void sinceLastVisit(projectId)
      .then((d) => live && setData(d))
      .catch(() => {
        // A missing summary costs nothing; it must never take the page down.
      })
    return () => {
      live = false
    }
  }, [projectId])

  if (!data || data.first_visit || !data.since || closed) return null

  const base = paths.project(projectId)
  const done = data.tasks_done ?? []
  const mine = data.assigned_to_me ?? []
  const items: { icon: IconName; text: string; to: string; strong?: boolean }[] = []
  if ((data.reviews_waiting ?? 0) > 0) {
    items.push({
      icon: 'refresh',
      text: `${plural(data.reviews_waiting!, 'change waits', 'changes wait')} for your review`,
      to: `${base}?tab=files&view=changes`,
      strong: true,
    })
  }
  if (mine.length > 0) {
    items.push({
      icon: 'user',
      text:
        mine.length === 1
          ? `You were given “${mine[0].title}”`
          : `You were given ${mine.length} tasks`,
      to: mine.length === 1 ? `${base}?tab=tasks&task=${mine[0].id}` : `${base}?tab=tasks`,
      strong: true,
    })
  }
  if ((data.comments_on_mine ?? 0) > 0) {
    items.push({
      icon: 'message',
      text: `${plural(data.comments_on_mine!, 'new comment', 'new comments')} on your tasks`,
      to: `${base}?tab=tasks`,
    })
  }
  if (done.length > 0) {
    items.push({
      icon: 'check',
      text:
        done.length === 1
          ? `“${done[0].title}” was finished`
          : `${done.length} tasks were finished`,
      to: done.length === 1 ? `${base}?tab=tasks&task=${done[0].id}` : `${base}?tab=progress`,
    })
  }
  if ((data.tasks_added ?? 0) > 0) {
    items.push({ icon: 'plus', text: plural(data.tasks_added!, 'new task', 'new tasks'), to: `${base}?tab=tasks` })
  }
  if ((data.commits ?? 0) > 0) {
    items.push({
      icon: 'folder',
      text: `${plural(data.commits!, 'change', 'changes')} saved to Files`,
      to: `${base}?tab=files&view=history`,
    })
  }
  if (items.length === 0) return null

  return (
    <section
      aria-label="Since you were last here"
      className="relative rounded-panel border border-line surface px-4 py-3.5 sm:px-5"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow">Since you were last here · {when(data.since)}</p>
        <button
          type="button"
          onClick={() => setClosed(true)}
          aria-label="Hide this summary"
          className="-mt-1 -mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-faint hover:bg-[var(--surface-sunken)] hover:text-ink"
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      <ul className="mt-2 flex flex-wrap gap-2">
        {items.map((it) => (
          <li key={it.text}>
            <Link
              to={it.to}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] transition-colors hover:border-line-strong ${
                it.strong ? 'border-warning-300 text-ink dark:border-warning-400/40' : 'border-line text-muted hover:text-ink'
              }`}
            >
              <Icon name={it.icon} size={14} className="shrink-0 text-faint" />
              {it.text}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
