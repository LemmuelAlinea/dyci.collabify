import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FilterChain } from '../../../components/analytics/FilterChain'
import { NeedsAttention } from '../../../components/analytics/NeedsAttention'
import { EMPTY_SCOPE } from '../../../components/analytics/scope'
import type { Scope } from '../../../components/analytics/scope'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { TaskDetailModal } from '../../../components/tasks/detail/TaskDetailModal'
import { Alert } from '../../../components/ui/Alert'
import { EmptyState } from '../../../components/ui/EmptyState'
import { Spinner } from '../../../components/ui/Icon'
import { Tabs } from '../../../components/ui/Tabs'
import type { Tab } from '../../../components/ui/Tabs'
import { useAuth } from '../../../context/AuthContext'
import { evidenceFor, readAnalyticsView } from '../../../lib/analyticsView'
import type { AnalyticsView } from '../../../lib/analyticsView'
import type { Action } from '../../../lib/insight'
import { dueSoonLabel, taskStatusLabel } from '../../../lib/types'
import { useAnalytics } from './useAnalytics'
import { ClassView } from './views/ClassView'
import { GroupsView } from './views/GroupsView'
import { ProjectsView } from './views/ProjectsView'
import { StudentsView } from './views/StudentsView'

const VIEW_TABS: Tab<AnalyticsView>[] = [
  { id: 'class', label: 'Class', icon: 'chart' },
  { id: 'groups', label: 'Groups', icon: 'users' },
  { id: 'students', label: 'Students', icon: 'user' },
  { id: 'projects', label: 'Projects', icon: 'folder' },
]

/**
 * What is happening across a professor's classes, asked four ways: the class,
 * its groups, its students, its projects. What needs doing sits on top, and
 * every item in it points at the chart that argues for it.
 *
 * Everything is counted, not guessed. The forward-looking figures are division,
 * and each prints the division beside it.
 */
export default function Analytics({ classId }: { classId?: string }) {
  const { profile } = useAuth()
  const data = useAnalytics(classId)
  const [openTask, setOpenTask] = useState<string | null>(null)
  const [openRequest, setOpenRequest] = useState(0)
  const [params, setParams] = useSearchParams()
  const view = readAnalyticsView(params.get('view'))
  const { scope, setScope, shownTasks } = data

  useEffect(() => {
    if (!classId) document.title = 'Analytics · Collabify'
  }, [classId])

  const setView = (next: AnalyticsView) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        n.set('view', next)
        return n
      },
      { replace: true },
    )

  // Narrowing to a person or a group is a question about them: go where it is answered.
  const onScope = (next: Scope) => {
    setScope(next)
    if (next.studentId && next.studentId !== scope.studentId) setView('students')
    else if (next.boardId && next.boardId !== scope.boardId) setView('groups')
  }

  // "See why" lands on the evidence itself: the view it is drawn in, scrolled
  // to the row it names. Bumped on every click, so the same card works twice.
  const [focus, setFocus] = useState<{ ids: string[]; boardId: string | null; n: number } | null>(null)

  const soloStudentOf = (boardId: string) => {
    const burn = data.burns.find((b) => b.board_id === boardId)
    if (!burn || burn.group_id) return null
    // Member load covers group boards; a solo board is known by its student's name.
    return (
      data.members.find((m) => m.board_id === boardId)?.student_id ??
      data.shownRoster.find((r) => r.class_id === burn.class_id && r.student_name === burn.student_name)?.student_id ??
      ''
    )
  }

  // A follow-up is about a person or a group: open their record, not just a tab.
  const seeWhy = (a: Action) => {
    const target = evidenceFor(a, soloStudentOf)
    setFocus((f) => ({ ids: target.ids, boardId: a.boardId, n: (f?.n ?? 0) + 1 }))
    if (a.kind === 'follow_up_due' && a.studentId) {
      setScope({ ...EMPTY_SCOPE, classId: a.classId, studentId: a.studentId })
      setOpenRequest((n) => n + 1)
      setView('students')
      return
    }
    if (a.kind === 'follow_up_due' && a.boardId) {
      const projectId = data.burns.find((b) => b.board_id === a.boardId)?.project_id ?? ''
      setScope({ ...EMPTY_SCOPE, classId: a.classId, projectId, boardId: a.boardId })
      setView('groups')
      return
    }
    setView(target.view)
  }

  // The view may still be mounting, so look for a moment before giving up.
  useEffect(() => {
    if (!focus || focus.ids.length === 0) return
    let tries = 0
    let timer = 0
    let unflash = 0
    let flashed: HTMLElement | null = null
    const find = () => {
      const el = focus.ids.map((id) => document.getElementById(id)).find(Boolean)
      if (!el) {
        if (++tries < 30) timer = window.setTimeout(find, 50)
        return
      }
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      // A whole section taller than the screen is read from its top.
      const tall = el.getBoundingClientRect().height > window.innerHeight * 0.7
      el.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: tall ? 'start' : 'center' })
      el.removeAttribute('data-attn')
      // Re-adding restarts the highlight when the same card is clicked again.
      void el.offsetWidth
      el.setAttribute('data-attn', '')
      flashed = el
      unflash = window.setTimeout(() => el.removeAttribute('data-attn'), 2600)
    }
    timer = window.setTimeout(find, 0)
    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(unflash)
      flashed?.removeAttribute('data-attn')
    }
  }, [focus])

  if (data.loading) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Working it out…
      </div>
    )
  }

  const empty = classId ? !data.health.some((c) => c.class_id === classId) : data.health.length === 0

  return (
    <div className="w-full space-y-6">
      {!classId && (
        <DirectoryHero
          title="Analytics,"
          accent="with context."
          description="Your class, its groups, its students and its projects, with what needs you first."
        />
      )}

      {data.error && <Alert tone="error" onRetry={data.reload}>{data.error}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line surface-sunken px-4 py-3.5 sm:px-5">
        <div>
          <p className="text-[12px] font-medium text-faint">Analysis scope</p>
          <p className="mt-0.5 text-[13px] text-muted">Start broad, then narrow only when needed.</p>
        </div>
        <FilterChain
          scope={scope}
          onChange={onScope}
          classes={classId ? data.health.filter((c) => c.class_id === classId) : data.health}
          burns={data.burns}
          members={data.members}
          tasks={data.tasks}
          lockClass={Boolean(classId)}
        />
      </div>

      {empty ? (
        <EmptyState
          icon="chart"
          title="Nothing to measure yet"
          body="Create a class, set its term dates and give it a syllabus, and its pace shows up here."
        />
      ) : (
        <>
          {data.notesError && <Alert tone="error" onRetry={data.reloadNotes}>{data.notesError}</Alert>}
          <NeedsAttention actions={data.actions} onSeeWhy={seeWhy} />

          <Tabs variant="panel" tabs={VIEW_TABS} active={view} onChange={setView} />

          {view === 'class' && <ClassView data={data} />}
          {view === 'groups' && <GroupsView data={data} focusBoardId={focus?.boardId ?? null} />}
          {view === 'students' && <StudentsView data={data} onOpenTask={setOpenTask} openRequest={openRequest} />}
          {view === 'projects' && <ProjectsView data={data} onOpenTask={setOpenTask} />}

          {(scope.boardId || scope.studentId || scope.taskId) && (
            <section className="space-y-3 border-t border-line pt-6">
              <h2>
                Tasks
                <span className="ml-2 font-mono text-[13px] text-faint">{shownTasks.length}</span>
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
                          <span className="shrink-0 rounded-md bg-danger-500/15 px-1.5 py-0.5 font-mono text-[12px] text-danger-700 dark:text-danger-300">
                            late
                          </span>
                        )}
                        {due && !t.late && <span className="shrink-0 font-mono text-[12px] text-faint">{due}</span>}
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
