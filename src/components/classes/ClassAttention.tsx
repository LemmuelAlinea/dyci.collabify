import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BentoTile, TileEmpty } from '../dashboard/Bento'
import { Alert } from '../ui/Alert'
import { Button, ButtonLink } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../context/AuthContext'
import { useLive } from '../../hooks/useLive'
import { boardsFor, groupsBehind } from '../../lib/api/dashboard'
import type { BehindBoard } from '../../lib/api/dashboard'
import { listProjectsForClasses } from '../../lib/api/projects'
import { teachingWaitingCounts } from '../../lib/api/waiting'
import { authErrorMessage } from '../../lib/authError'
import { classStudentsPath, isEmptyClass } from '../../lib/classSpace'
import { paths } from '../../lib/paths'
import { plural } from '../../lib/plural'
import type { ClassSummary } from '../../lib/types'

type State = { handIns: number; requests: number; projects: number; behind: BehindBoard[] }

/**
 * What needs the teacher in this one class, on its Overview: what is waiting
 * on them here and which groups are behind. A class with no students and no
 * projects gets the next step to take instead, until either exists.
 */
export function ClassAttention({ cls }: { cls: ClassSummary }) {
  const { profile } = useAuth()
  const [data, setData] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)
  const userId = profile?.id

  const load = useCallback(async () => {
    if (!userId) return
    try {
      const [counts, projects] = await Promise.all([
        teachingWaitingCounts(userId, cls.id),
        listProjectsForClasses([cls.id]),
      ])
      const boards = await boardsFor(projects.filter((p) => !p.archived_at).map((p) => p.id))
      setData({ ...counts, projects: projects.length, behind: groupsBehind(boards) })
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load what needs you in this class.'))
    }
  }, [userId, cls.id])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['projects', 'project_boards', 'project_tasks', 'board_results', 'task_reassignments'])

  if (error && !data) {
    return (
      <Alert tone="error" onRetry={load}>
        {error}
      </Alert>
    )
  }
  if (!data) return null

  if (!cls.archived_at && isEmptyClass(cls.student_count, data.projects)) {
    return <NextSteps cls={cls} />
  }

  const waiting = data.handIns + data.requests

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <BentoTile
        icon="checkCircle"
        title="Waiting on you here"
        count={waiting}
        seeAll={paths.waiting}
        seeAllLabel="Open"
      >
        {waiting === 0 ? (
          <TileEmpty>Nothing in this class is waiting on you.</TileEmpty>
        ) : (
          <ul className="-mx-2 divide-y divide-[var(--line)]">
            <WaitingRow
              to={`${paths.waiting}?status=waiting`}
              value={data.handIns}
              label={plural(data.handIns, 'hand-in to answer', 'hand-ins to answer')}
            />
            <WaitingRow
              to={`${paths.waiting}?section=reassignments`}
              value={data.requests}
              label={plural(data.requests, 'reassignment to decide', 'reassignments to decide')}
            />
          </ul>
        )}
      </BentoTile>

      <BentoTile icon="alert" title="Groups behind" count={data.behind.length}>
        {data.behind.length === 0 ? (
          <TileEmpty>Nothing is behind</TileEmpty>
        ) : (
          <ul className="-mx-2 divide-y divide-[var(--line)]">
            {data.behind.map((b) => (
              <BehindRow key={b.id} board={b} />
            ))}
          </ul>
        )}
      </BentoTile>
    </div>
  )
}

function WaitingRow({ to, value, label }: { to: string; value: number; label: string }) {
  return (
    <li>
      <Link
        to={to}
        className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-[var(--surface-sunken)]"
      >
        <span
          className={`w-8 shrink-0 text-right font-mono text-[18px] ${
            value > 0 ? 'text-warning-700 dark:text-warning-300' : 'text-faint'
          }`}
        >
          {value}
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{label}</span>
        <Icon name="chevronRight" size={14} className="shrink-0 text-faint" />
      </Link>
    </li>
  )
}

function BehindRow({ board: b }: { board: BehindBoard }) {
  const why =
    b.reason === 'empty'
      ? 'No tasks at all'
      : b.reason === 'quiet'
        ? `Quiet for ${b.days} ${plural(b.days, 'day', 'days')}`
        : null
  const late = b.late_count > 0 ? `${b.late_count} late ${plural(b.late_count, 'task', 'tasks')}` : null

  return (
    <li>
      <Link
        to={paths.classProjectBoard(b.project_id, b.id)}
        className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-[var(--surface-sunken)]"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-warning-400/18 text-warning-700 dark:text-warning-300">
          <Icon name={b.reason === 'quiet' ? 'clock' : 'alert'} size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-ink">
            {b.group_name ?? b.student_name ?? 'One student'}
          </span>
          <span className="block truncate text-[12px] text-muted">{b.project_title}</span>
        </span>
        <span className="shrink-0 text-right text-[12px] text-warning-700 dark:text-warning-300">
          {[why, late].filter(Boolean).join(' · ')}
        </span>
      </Link>
    </li>
  )
}

/** The first two things a new class needs, in order. */
function NextSteps({ cls }: { cls: ClassSummary }) {
  const { show } = useToast()
  const [copied, setCopied] = useState(false)

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(cls.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      show('Could not copy. Select the code and copy it manually.', 'error')
    }
  }

  return (
    <section className="surface rounded-card border border-line p-4 shadow-card sm:p-5">
      <p className="eyebrow">Next steps</p>
      <h2 className="mt-1 text-[17px]">Get this class started</h2>
      <ol className="mt-4 grid gap-3 md:grid-cols-2">
        <li className="flex gap-3 rounded-xl border border-line p-4">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-navy-600 font-mono text-[13px] text-white dark:bg-amber-400 dark:text-navy-900">
            1
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px]">Add your students</h3>
            <p className="mt-1 text-[13px] text-muted">
              Students join themselves with the class code{' '}
              <span className="font-mono text-ink">{cls.code}</span>.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={copyCode}>
                <Icon name={copied ? 'check' : 'copy'} size={14} />
                {copied ? 'Copied' : 'Copy code'}
              </Button>
              <ButtonLink size="sm" variant="outline" to={classStudentsPath(cls.id)}>
                Open Students
              </ButtonLink>
            </div>
          </div>
        </li>
        <li className="flex gap-3 rounded-xl border border-line p-4">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full surface-sunken font-mono text-[13px] text-muted">
            2
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px]">Set your first project</h3>
            <p className="mt-1 text-[13px] text-muted">
              Give the class its first project, with groups or one board per student.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <ButtonLink size="sm" variant="outline" to={`${paths.class(cls.id)}?tab=projects`}>
                Open Projects
              </ButtonLink>
            </div>
          </div>
        </li>
      </ol>
    </section>
  )
}
