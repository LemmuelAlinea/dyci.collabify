import { useState } from 'react'
import { FilterChain } from '../../../components/analytics/FilterChain'
import { TaskDetailModal } from '../../../components/tasks/detail/TaskDetailModal'
import { Alert } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Icon'
import { EmptyState } from '../../../components/ui/Tabs'
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

  if (data.loading) {
    return (
      <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Working it out…
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">Teaching</p>
        <h1 className="mt-1 text-[30px] leading-tight">Analytics</h1>
        <p className="mt-2 max-w-[70ch] text-[14.5px] text-muted">
          Narrow to a class, a project, a group, one student or a single task. The page then
          answers four questions about whatever you chose: what has happened, why, what is
          coming, and what to do next.
        </p>
      </header>

      {data.error && <Alert tone="error">{data.error}</Alert>}

      <FilterChain
        scope={scope}
        onChange={setScope}
        classes={data.health}
        burns={data.burns}
        members={data.members}
        tasks={data.tasks}
      />

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
              <h2 className="text-[17px]">
                Tasks
                <span className="ml-2 font-mono text-[13px] text-faint">
                  {shownTasks.length}
                </span>
              </h2>
              <ul className="space-y-1.5">
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
                        <span className="shrink-0 rounded-md surface-sunken px-2 py-0.5 font-mono text-[11px] text-muted">
                          {taskStatusLabel(t.status)}
                        </span>
                        {t.late && (
                          <span className="shrink-0 rounded-md bg-red-500/15 px-1.5 py-0.5 font-mono text-[10.5px] text-red-700 dark:text-red-300">
                            late
                          </span>
                        )}
                        {due && !t.late && (
                          <span className="shrink-0 font-mono text-[11.5px] text-faint">
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
