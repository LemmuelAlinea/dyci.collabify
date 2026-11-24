import { useEffect, useState } from 'react'
import { Alert } from '../../ui/Alert'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Field'
import { Select } from '../../ui/Select'
import { useToast } from '../../ui/Toast'
import { TypePicker } from '../../taskTypes/TypePicker'
import { parseTypeSet, resolveType, typeOptions } from '../../../lib/taskTypes/typeSet'
import { getClassTaskSettings } from '../../../lib/api/projects'
import type { ClassTaskSettings } from '../../../lib/api/projects'
import {
  addClassSubtask, listClassTaskRelations, setClassTaskDependency, updateClassTaskFields,
} from '../../../lib/api/tasks'
import { authErrorMessage } from '../../../lib/authError'
import { PRIORITIES } from '../../../lib/general/types'
import type { ProjectTask, TaskDetail, TeachingViewRole } from '../../../lib/types'

type Relation = Awaited<ReturnType<typeof listClassTaskRelations>>

function localDate(iso: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function TaskExtras({ task, role, viewerId, locked, onOpenTask, onChanged }: {
  task: TaskDetail
  role: TeachingViewRole
  viewerId: string | undefined
  locked: boolean
  onOpenTask: (taskId: string) => void
  onChanged: () => Promise<void> | void
}) {
  const { show } = useToast()
  const [settings, setSettings] = useState<ClassTaskSettings | null>(null)
  const [relations, setRelations] = useState<Relation | null>(null)
  const [due, setDue] = useState(localDate(task.due_at))
  const [type, setType] = useState(task.task_type)
  const [priority, setPriority] = useState(task.priority)
  const [childTitle, setChildTitle] = useState('')
  const [dependency, setDependency] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editable = !locked && (role === 'professor' || task.status === 'todo')

  useEffect(() => {
    setDue(localDate(task.due_at))
    setType(task.task_type)
    setPriority(task.priority)
  }, [task.id, task.due_at, task.task_type, task.priority])
  useEffect(() => {
    let live = true
    getClassTaskSettings(task.project_id).then((value) => live && setSettings(value))
      .catch((err) => live && setError(authErrorMessage(err, 'Could not load task rules.')))
    return () => { live = false }
  }, [task.project_id])
  async function load() {
    setRelations(await listClassTaskRelations(task.board_id, task.id))
  }
  useEffect(() => {
    let live = true
    setRelations(null)
    setError(null)
    listClassTaskRelations(task.board_id, task.id).then((value) => live && setRelations(value))
      .catch((err) => live && setError(authErrorMessage(err, 'Could not load related tasks.')))
    return () => { live = false }
  }, [task.board_id, task.id])

  async function run(work: () => Promise<void>, message: string) {
    setBusy(true)
    setError(null)
    try {
      await work()
      await Promise.all([load(), onChanged()])
      show(message)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not update the task.'))
    } finally { setBusy(false) }
  }

  const tasks = relations?.tasks ?? []
  const children = tasks.filter((item) => item.parent_id === task.id)
  const parent = tasks.find((item) => item.id === task.parent_id)
  const dependencies = relations?.dependencies ?? []
  const options = tasks.filter((item) => item.id !== task.id && !dependencies.includes(item.id))
  const typeSet = parseTypeSet(settings?.task_type_set, 'class')
  const typeChoices = typeOptions(typeSet, { family: 'class', current: resolveType(typeSet, { task_type: type }, 'class') })

  return <div className="space-y-6">
    {error && <Alert tone="error">{error}</Alert>}
    <section className="space-y-3">
      <h3 className="text-[14px]">Task details</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><span className="text-[12px] text-muted">Type</span>
          <TypePicker label="Type" value={type} disabled={!editable || busy} onChange={setType} options={typeChoices} />
        </div>
        <label className="space-y-1"><span className="text-[12px] text-muted">Priority</span>
          <Select value={priority} disabled={!editable || busy} onChange={(e) => setPriority(e.target.value as ProjectTask['priority'])}
            options={PRIORITIES.map((item) => ({ value: item.value, label: item.label }))} />
        </label>
        <label className="space-y-1"><span className="text-[12px] text-muted">Due</span>
          <Input type="datetime-local" value={due} disabled={!editable || busy} onChange={(e) => setDue(e.target.value)} />
        </label>
      </div>
      {editable && <Button size="sm" disabled={busy || (due === localDate(task.due_at) && type === task.task_type && priority === task.priority)}
        onClick={() => void run(async () => {
          const dueAt = due ? new Date(due).toISOString() : null
          if (dueAt && task.starts_at && dueAt < task.starts_at) throw new Error('Due must be after the planned start.')
          await updateClassTaskFields(task.id, { due_at: dueAt, task_type: type, priority })
        }, 'Task details saved')}>Save details</Button>}
    </section>

    {(parent || children.length > 0 || (editable && settings?.allow_subtasks && !task.parent_id)) &&
      <section className="space-y-2"><h3 className="text-[14px]">Subtasks</h3>
        {parent && <button type="button" onClick={() => onOpenTask(parent.id)}
          className="text-[13px] text-navy-600 hover:underline dark:text-navy-200">Part of {parent.title}</button>}
        {children.map((child) => <button key={child.id} type="button" onClick={() => onOpenTask(child.id)}
          className="block text-left text-[13px] text-navy-600 hover:underline dark:text-navy-200">
          {child.title} · {child.status === 'done' ? 'Done' : 'Open'}
        </button>)}
        {editable && settings?.allow_subtasks && !task.parent_id && viewerId &&
          <div className="flex gap-2"><Input aria-label="New subtask" value={childTitle} maxLength={140} disabled={busy}
            onChange={(e) => setChildTitle(e.target.value)} placeholder="New subtask" />
            <Button size="sm" disabled={busy || !childTitle.trim()} onClick={() => void run(async () => {
              await addClassSubtask(task, childTitle, viewerId, role === 'professor' ? 'professor' : 'student')
              setChildTitle('')
            }, 'Subtask added')}>Add</Button></div>}
      </section>}

    {(dependencies.length > 0 || (editable && settings?.allow_dependencies)) &&
      <section className="space-y-2"><h3 className="text-[14px]">Depends on</h3>
        {dependencies.map((id) => <div key={id} className="flex items-center gap-2 text-[13px] text-ink">
          <span>{tasks.find((item) => item.id === id)?.title ?? 'Task'}</span>
          {editable && <Button size="sm" variant="ghost" disabled={busy}
            onClick={() => void run(() => setClassTaskDependency(task.id, id, false), 'Dependency removed')}>Remove</Button>}
        </div>)}
        {editable && settings?.allow_dependencies && <div className="flex gap-2">
          <Select aria-label="Add dependency" value={dependency} onChange={(e) => setDependency(e.target.value)}
            disabled={busy} placeholder="Choose a task" options={options.map((item) => ({ value: item.id, label: item.title }))} />
          <Button size="sm" disabled={busy || !dependency} onClick={() => void run(async () => {
            await setClassTaskDependency(task.id, dependency, true)
            setDependency('')
          }, 'Dependency added')}>Add</Button>
        </div>}
      </section>}
  </div>
}
