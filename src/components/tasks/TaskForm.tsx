import { useState } from 'react'
import type { FormEvent } from 'react'
import { Field, Input } from '../ui/Field'
import { Alert } from '../ui/Alert'
import { Textarea } from '../ui/Select'
import { Select } from '../ui/Select'
import { PRIORITIES } from '../../lib/general/types'
import type { TaskInput } from '../../lib/api/tasks'
import type { ProjectTask } from '../../lib/types'

function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TaskForm({
  formId,
  defaults,
  showStart = false,
  taskTypes = [],
  defaultPriority = 'normal',
  error,
  onSubmit,
}: {
  formId: string
  defaults?: Pick<ProjectTask, 'title' | 'details' | 'weight' | 'due_at'> & {
    starts_at?: string | null
    task_type?: string
    priority?: ProjectTask['priority']
  }
  /** Students' board only. */
  showStart?: boolean
  taskTypes?: string[]
  defaultPriority?: ProjectTask['priority']
  error?: string | null
  onSubmit: (input: TaskInput) => void
}) {
  const [title, setTitle] = useState(defaults?.title ?? '')
  const [details, setDetails] = useState(defaults?.details ?? '')
  const [weight, setWeight] = useState(defaults?.weight ?? 1)
  const [taskType, setTaskType] = useState(defaults?.task_type ?? 'Task')
  const [priority, setPriority] = useState(defaults?.priority ?? defaultPriority)
  const [dueAt, setDueAt] = useState(toLocalInput(defaults?.due_at ?? null))
  const [startsAt, setStartsAt] = useState(toLocalInput(defaults?.starts_at ?? null))
  const [invalid, setInvalid] = useState<string | null>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return setInvalid('Give the task a name.')
    const startIso = showStart && startsAt ? new Date(startsAt).toISOString() : null
    const dueIso = dueAt ? new Date(dueAt).toISOString() : null
    if (startIso && dueIso && startIso > dueIso)
      return setInvalid('A task cannot start after it is due. Move one of the two dates.')
    setInvalid(null)
    onSubmit({
      title,
      details,
      weight,
      taskType,
      priority,
      dueAt: dueIso,
      ...(showStart && { startsAt: startIso }),
    })
  }

  return (
    <form id={formId} onSubmit={submit} className="space-y-4">
      {(error || invalid) && <Alert tone="error">{error ?? invalid}</Alert>}

      <Field label="Task">
        {(id) => (
          <Input
            id={id}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Draw the entity relationship diagram"
            maxLength={140}
          />
        )}
      </Field>

      <Field label="Details" optional>
        {(id) => (
          <Textarea
            id={id}
            rows={4}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="What finishing this actually means."
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type">{(id) => <Select id={id} value={taskType} onChange={(e) => setTaskType(e.target.value)}
          options={[{ value: 'Task', label: 'Task' }, ...[...new Set([...taskTypes, taskType])]
            .filter((name) => name !== 'Task').map((name) => ({ value: name, label: name }))]} />}</Field>
        <Field label="Priority">{(id) => <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value as ProjectTask['priority'])}
          options={PRIORITIES.map((option) => ({ value: option.value, label: option.label }))} />}</Field>
      </div>

      {/* With a planned start, Weight sits on its own row so Starts and Due share one. */}
      <div className={showStart ? 'space-y-4' : 'grid gap-4 sm:grid-cols-2'}>
        <Field
          label="Weight"
          hint={<span className="text-[12px] text-faint">Relative size</span>}
        >
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={100}
              value={weight}
              onChange={(e) => setWeight(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
            />
          )}
        </Field>

        <div className={showStart ? 'grid gap-4 sm:grid-cols-2' : 'contents'}>
          {showStart && (
            <Field label="Starts" optional>
              {(id) => (
                <Input id={id} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              )}
            </Field>
          )}

          <Field label="Due" optional>
            {(id) => (
              <Input
                id={id}
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            )}
          </Field>
        </div>
      </div>

      <p className="text-[12px] leading-relaxed text-faint">
        Weight is how big this is next to the group's other tasks — a heavier task is worth
        more of the project. Everything can be changed until someone starts it.
      </p>
    </form>
  )
}
