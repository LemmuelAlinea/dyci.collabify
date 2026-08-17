import { useState } from 'react'
import { Button } from '../ui/Button'
import { Alert } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { TaskForm } from './TaskForm'
import { createProfessorTask, updateProfessorTask } from '../../lib/api/tasks'
import type { ProfessorTaskGroup, TaskInput } from '../../lib/api/tasks'
import { authErrorMessage } from '../../lib/authError'
import type { BoardSummary } from '../../lib/types'

const FORM_ID = 'fan-out-form'

/**
 * A professor writes the work once and hands it to one group or to all of them.
 * Each board gets its own copy, so a group can reword theirs until they start.
 */
export function FanOutForm({
  open,
  onClose,
  projectId,
  boards,
  editing,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  boards: BoardSummary[]
  /** Set to edit a task already handed out. */
  editing?: ProfessorTaskGroup
  onSaved: (message: string) => Promise<void> | void
}) {
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(input: TaskInput) {
    setError(null)
    setBusy(true)
    try {
      if (editing) {
        const res = await updateProfessorTask(editing.origin_id, input)
        if (res.result !== 'updated') throw new Error('That task could not be changed.')
        await onSaved(
          res.frozen
            ? `Updated ${res.changed} of ${(res.changed ?? 0) + res.frozen} copies — ${res.frozen} already started`
            : 'Task updated everywhere',
        )
      } else {
        const res = await createProfessorTask({
          projectId,
          title: input.title,
          details: input.details,
          weight: input.weight,
          dueAt: input.dueAt,
          boardId: target || null,
        })
        if (res.result !== 'created') {
          throw new Error(
            res.result === 'no_title'
              ? 'Give the task a name.'
              : 'That task could not be created.',
          )
        }
        await onSaved(
          `Task sent to ${res.boards} ${res.boards === 1 ? 'group' : 'groups'}`,
        )
      }
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save that task.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit the task you set' : 'Set a task'}
      description={
        editing
          ? 'Changes reach only the groups that have not started theirs yet.'
          : 'You write it. The group decides who does it.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button form={FORM_ID} type="submit" loading={busy} className="!rounded-xl">
            {editing ? 'Save changes' : 'Set task'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        {editing ? (
          <p className="flex items-start gap-2 rounded-xl border border-line surface-sunken px-3.5 py-3 text-[13px] text-muted">
            <Icon name="info" size={15} className="mt-px shrink-0" />
            {editing.started > 0
              ? `${editing.started} of ${editing.boards} groups have already started this. Their copy keeps its own wording.`
              : `On ${editing.boards} ${editing.boards === 1 ? 'board' : 'boards'}, none started yet.`}
          </p>
        ) : (
          <label className="block space-y-1.5">
            <span className="text-[13.5px] font-medium text-ink">Who gets it</span>
            <Select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={`Every group (${boards.length})`}
              options={boards.map((b) => ({
                value: b.id,
                label: b.group_name ?? 'One student',
              }))}
            />
          </label>
        )}

        <TaskForm
          key={editing?.origin_id ?? 'new'}
          formId={FORM_ID}
          defaults={
            editing
              ? {
                  title: editing.title,
                  details: editing.details,
                  weight: editing.weight,
                  due_at: editing.due_at,
                }
              : undefined
          }
          onSubmit={save}
        />
      </div>
    </Modal>
  )
}
