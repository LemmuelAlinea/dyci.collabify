import { useState } from 'react'
import { MonthGrid } from '../calendar/MonthGrid'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import type { CalendarEvent } from '../../lib/types'

const thisMonth = () => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

/** A project's tasks by due date, one month at a time. */
export function TaskCalendar({ events, onOpen }: { events: CalendarEvent[]; onOpen: (taskId: string) => void }) {
  const [month, setMonth] = useState(thisMonth)
  const label = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const undated = events.length === 0

  return (
    <section className="rounded-panel border border-line surface p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3>{label}</h3>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="!h-8 !rounded-lg !px-2.5"
            onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
          >
            <Icon name="chevronLeft" size={15} />
            <span className="sr-only">Previous month</span>
          </Button>
          <Button variant="ghost" size="sm" className="!h-8 !rounded-lg !px-3" onClick={() => setMonth(thisMonth())}>
            Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="!h-8 !rounded-lg !px-2.5"
            onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
          >
            <Icon name="chevronRight" size={15} />
            <span className="sr-only">Next month</span>
          </Button>
        </div>
      </div>
      {undated && (
        <p className="mb-3 text-[12px] text-faint">No task here has a due date yet. Give one a due date and it shows on its day.</p>
      )}
      <MonthGrid
        month={month}
        events={events}
        weeks={[]}
        showSyllabus={false}
        onOpen={(e) => {
          if (e.task_id) onOpen(e.task_id)
        }}
      />
    </section>
  )
}
