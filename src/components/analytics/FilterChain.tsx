import { useMemo } from 'react'
import { Icon } from '../ui/Icon'
import { Select } from '../ui/Select'
import { burnOwner } from '../../lib/types'
import type { BoardBurn, ClassRef, MemberLoad, TaskState } from '../../lib/types'

export type Scope = {
  classId: string
  projectId: string
  boardId: string
  studentId: string
  taskId: string
}

export const EMPTY_SCOPE: Scope = {
  classId: '',
  projectId: '',
  boardId: '',
  studentId: '',
  taskId: '',
}

const ORDER: (keyof Scope)[] = ['classId', 'projectId', 'boardId', 'studentId', 'taskId']

/**
 * Class → project → group → student → task, each choice narrowing the next.
 *
 * Cascading rather than five independent dropdowns: most free combinations — a
 * student from one class against a project from another — return nothing, and
 * an empty page then means "impossible question" rather than "nothing there",
 * which is the more alarming of the two to read.
 *
 * Choosing higher up clears everything below it, so the chain can never be left
 * describing two different subjects at once.
 */
export function FilterChain({
  scope,
  onChange,
  classes,
  burns,
  members,
  tasks,
}: {
  scope: Scope
  onChange: (next: Scope) => void
  // Every class, not only the paced ones — a class with no term dates still
  // has boards and tasks worth narrowing to.
  classes: ClassRef[]
  burns: BoardBurn[]
  members: MemberLoad[]
  tasks: TaskState[]
}) {
  const projects = useMemo(() => {
    const seen = new Map<string, string>()
    for (const b of burns) {
      if (scope.classId && b.class_id !== scope.classId) continue
      seen.set(b.project_id, b.project_title)
    }
    return [...seen].map(([value, label]) => ({ value, label }))
  }, [burns, scope.classId])

  const boards = useMemo(
    () =>
      burns
        .filter((b) => (scope.classId ? b.class_id === scope.classId : true))
        .filter((b) => (scope.projectId ? b.project_id === scope.projectId : true))
        .map((b) => ({ value: b.board_id, label: burnOwner(b) })),
    [burns, scope.classId, scope.projectId],
  )

  const students = useMemo(() => {
    const seen = new Map<string, string>()
    for (const m of members) {
      if (scope.classId && m.class_id !== scope.classId) continue
      if (scope.projectId && m.project_id !== scope.projectId) continue
      if (scope.boardId && m.board_id !== scope.boardId) continue
      seen.set(m.student_id, m.student_name)
    }
    return [...seen].map(([value, label]) => ({ value, label }))
  }, [members, scope.classId, scope.projectId, scope.boardId])

  const taskOptions = useMemo(
    () =>
      tasks
        .filter((t) => (scope.classId ? t.class_id === scope.classId : true))
        .filter((t) => (scope.projectId ? t.project_id === scope.projectId : true))
        .filter((t) => (scope.boardId ? t.board_id === scope.boardId : true))
        .filter((t) => (scope.studentId ? t.assignee_ids.includes(scope.studentId) : true))
        .slice(0, 200)
        .map((t) => ({ value: t.task_id, label: t.title })),
    [tasks, scope],
  )

  // Narrowing at any level invalidates everything under it.
  function set(level: keyof Scope, value: string) {
    const from = ORDER.indexOf(level)
    const next = { ...scope, [level]: value }
    for (const k of ORDER.slice(from + 1)) next[k] = ''
    onChange(next)
  }

  const touched = ORDER.some((k) => scope[k])

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <Select
          aria-label="Class"
          value={scope.classId}
          onChange={(e) => set('classId', e.target.value)}
          placeholder="Every class"
          options={classes.map((c) => ({
            value: c.class_id,
            label: `${c.class_initial} · ${c.class_name}`,
          }))}
          className="!h-9 !text-[13px]"
        />
        <Select
          aria-label="Project"
          value={scope.projectId}
          onChange={(e) => set('projectId', e.target.value)}
          placeholder="Every project"
          options={projects}
          className="!h-9 !text-[13px]"
        />
        <Select
          aria-label="Group"
          value={scope.boardId}
          onChange={(e) => set('boardId', e.target.value)}
          placeholder="Every group"
          options={boards}
          className="!h-9 !text-[13px]"
        />
        <Select
          aria-label="Student"
          value={scope.studentId}
          onChange={(e) => set('studentId', e.target.value)}
          placeholder="Everyone"
          options={students}
          className="!h-9 !text-[13px]"
        />
        <Select
          aria-label="Task"
          value={scope.taskId}
          onChange={(e) => set('taskId', e.target.value)}
          placeholder="Every task"
          options={taskOptions}
          className="!h-9 !text-[13px]"
        />
      </div>

      {touched && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_SCOPE)}
          className="flex items-center gap-1.5 text-[12.5px] font-medium text-navy-600 hover:underline dark:text-navy-200"
        >
          <Icon name="x" size={13} />
          Clear the filters
        </button>
      )}
    </div>
  )
}
