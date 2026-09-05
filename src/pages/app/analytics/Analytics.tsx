import { useEffect, useState } from 'react'
import { FilterChain } from '../../../components/analytics/FilterChain'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { TaskDetailModal } from '../../../components/tasks/detail/TaskDetailModal'
import { Alert } from '../../../components/ui/Alert'
import { Spinner } from '../../../components/ui/Icon'
import { EmptyState } from '../../../components/ui/EmptyState'
import { useAuth } from '../../../context/AuthContext'
import { dueSoonLabel, taskStatusLabel } from '../../../lib/types'
import { Descriptive } from './bands/Descriptive'
import { Diagnostic } from './bands/Diagnostic'
import { Predictive } from './bands/Predictive'
import { Prescriptive } from './bands/Prescriptive'
import { useAnalytics } from './useAnalytics'

/**
 * What is happening across a professor's classes, at whatever depth they ask.
 *
 * Four bands, read top to bottom as one argument: what has happened, why it is
 * where it is, what is coming, and what to do about it. The recommendations at
 * the bottom are the payoff of everything above them, which is why they are
 * last rather than first — a professor should be able to see the evidence for
 * an instruction before following it.
 *
 * Everything is counted, not guessed. The forward-looking figures are division,
 * and each prints the division beside it. A model over one class and sixteen
 * finished tasks would be a confident number with nothing behind it.
 */
export default function Analytics() {
  const { profile } = useAuth()
  const data = useAnalytics()
  const [openTask, setOpenTask] = useState<string | null>(null)
  const { scope, setScope, shownTasks } = data

  useEffect(() => {
    document.title = 'Analytics · Collabify'
  }, [])

  if (data.loading) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Working it out…
      </div>
    )
  }

  return (
    <div className="w-full space-y-6">
      <DirectoryHero
        title="Analytics,"
        accent="with context."
        description="Move from what happened to why it happened, what is coming and what needs attention next."
        stats={[
          { value: data.health.length, label: 'Classes measured' },
          { value: shownTasks.length, label: 'Tasks in view' },
        ]}
      />

      {data.error && <Alert tone="error" onRetry={data.reload}>{data.error}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line surface-sunken px-4 py-3.5 sm:px-5">
        <div>
          <p className="text-[12px] font-medium text-faint">Analysis scope</p>
          <p className="mt-0.5 text-[13px] text-muted">Start broad, then narrow only when needed.</p>
        </div>
        <FilterChain
          scope={scope}
          onChange={setScope}
          classes={data.health}
          burns={data.burns}
          members={data.members}
          tasks={data.tasks}
        />
      </div>

      {data.health.length === 0 ? (
        <EmptyState
          icon="chart"
          title="Nothing to measure yet"
          body="Create a class, set its term dates and give it a syllabus, and its pace shows up here."
        />
      ) : (
        <>
          <Descriptive data={data} />
          <Diagnostic data={data} />
          <Predictive data={data} />
          <Prescriptive data={data} />

          {/* The leaf. Only worth the room once the question is narrow. */}
          {(scope.boardId || scope.studentId || scope.taskId) && (
            <section className="space-y-3 border-t border-line pt-6">
              <h2>
                Tasks
                <span className="ml-2 font-mono text-[13px] text-faint">
                  {shownTasks.length}
                </span>
              </h2>
              <ul className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
                {shownTasks.map((t) => {
                  const due = dueSoonLabel(t.due_at)
                  return (
                    <li key={t.task_id}>
                      <button
                        type="button"
                        onClick={() => setOpenTask(t.task_id)}
                        className="surface flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line px-3.5 py-2.5 text-left transition-colors hover:border-line-strong"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] text-ink">{t.title}</span>
                          <span className="block truncate text-[12px] text-faint">
                            {t.group_name ?? t.board_student_name} · {t.project_title}
                            {t.assignee_names && ` · ${t.assignee_names}`}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-md surface-sunken px-2 py-0.5 font-mono text-[12px] text-muted">
                          {taskStatusLabel(t.status)}
                        </span>
                        {t.late && (
                          <span className="shrink-0 rounded-md bg-red-500/15 px-1.5 py-0.5 font-mono text-[12px] text-red-700 dark:text-red-300">
                            late
                          </span>
                        )}
                        {due && !t.late && (
                          <span className="shrink-0 font-mono text-[12px] text-faint">
                            {due}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </>
      )}

      <TaskDetailModal
        taskId={openTask}
        onClose={() => setOpenTask(null)}
        viewerId={profile?.id}
        role="professor"
        boardWeight={0}
        onChanged={data.reload}
      />
    </div>
  )
}
