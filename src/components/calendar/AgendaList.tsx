import { useMemo } from 'react'
import { EventChip } from './EventChip'
import { EmptyState } from '../ui/EmptyState'
import { calendarDaysUntil, dayKey, hasPassed } from '../../lib/types'
import type { CalendarEvent } from '../../lib/types'

function heading(iso: string) {
  const days = calendarDaysUntil(iso)
  const stamp = new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  if (days === 0) return `Today · ${stamp}`
  if (days === 1) return `Tomorrow · ${stamp}`
  if (days === -1) return `Yesterday · ${stamp}`
  return stamp
}

/**
 * What is coming, in order. The month says what shape the term is; this answers
 * "what do I do next", which is the question anybody actually opens a calendar
 * with — and it is the only one of the two that survives a phone.
 *
 * Day buckets come from calendarDaysUntil rather than being counted here, so
 * this cannot drift out of agreement with the labels on the cards.
 */
export function AgendaList({
  events,
  onOpen,
  /** Hide what has already gone by, which is the usual thing to want. */
  showPast = false,
}: {
  events: CalendarEvent[]
  onOpen: (event: CalendarEvent) => void
  showPast?: boolean
}) {
  const days = useMemo(() => {
    const kept = showPast
      ? events
      : events.filter((e) => !hasPassed(e.at) || calendarDaysUntil(e.at) === 0)

    const map = new Map<string, CalendarEvent[]>()
    for (const e of [...kept].sort((a, b) => a.at.localeCompare(b.at))) {
      const k = dayKey(e.at)
      const list = map.get(k)
      if (list) list.push(e)
      else map.set(k, [e])
    }
    return [...map.entries()]
  }, [events, showPast])

  if (days.length === 0) {
    return (
      <EmptyState
        icon="calendar"
        title="Nothing ahead"
        body={
          showPast
            ? 'No dates on any of your classes yet.'
            : 'Nothing is coming up. Turn on past dates to see what has already gone by.'
        }
      />
    )
  }

  return (
    <ol className="space-y-5">
      {days.map(([key, list]) => (
        <li key={key}>
          <p className="eyebrow pb-2">{heading(list[0].at)}</p>
          <ul className="space-y-1.5">
            {list.map((e) => (
              <li
                key={`${e.kind}:${e.ref_id}`}
                className="surface flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-line px-3 py-2.5"
              >
                <span className="min-w-0 flex-1">
                  <EventChip event={e} onOpen={onOpen} />
                </span>
                <span className="text-[12px] text-faint">
                  {e.class_initial} · {e.project_title}
                  {e.group_name ? ` · ${e.group_name}` : ''}
                </span>
                <span className="font-mono text-[12px] text-faint">
                  {new Date(e.at).toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  )
}
