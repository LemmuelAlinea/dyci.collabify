import { useState } from 'react'
import { Button } from '../ui/Button'
import { Alert } from '../ui/Alert'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { TaskForm } from './TaskForm'
import { setOriginMilestone } from '../../lib/api/milestones'
import { createProfessorTask, updateProfessorTask } from '../../lib/api/tasks'
import type { ProfessorTaskGroup, TaskInput } from '../../lib/api/tasks'
import { authErrorMessage } from '../../lib/authError'
import type { BoardSummary } from '../../lib/types'
import type { Milestone } from '../../lib/work/types'

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
  milestones,
  editing,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  boards: BoardSummary[]
  milestones: Milestone[]
  /** Set to edit a task already handed out. */
  editing?: ProfessorTaskGroup
  onSaved: (message: string) => Promise<void> | void
}) {
  const [target, setTarget] = useState('')
  const [milestoneId, setMilestoneId] = useState(editing?.milestone_id ?? '')
  // The form stays mounted between tasks, so follow the one being edited.
  const editKey = editing?.origin_id ?? ''
  const [seenKey, setSeenKey] = useState(editKey)
  if (seenKey !== editKey) {
    setSeenKey(editKey)
    setMilestoneId(editing?.milestone_id ?? '')
  }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Closing drops the form's picks, so a cancelled task leaves nothing behind. */
  function close() {
    setTarget('')
    setMilestoneId('')
    onClose()
  }

  /**
   * The task is already saved by the time this runs, so a failure here must not
   * read as a failed save: a retry would send the task out a second time.
   */
  async function applyMilestone(originId: string | undefined, value: string) {
    try {
      if (originId) await setOriginMilestone(originId, value || null)
      return true
    } catch {
      return false
    }
  }

  async function save(input: TaskInput) {
    setError(null)
    setBusy(true)
    try {
      if (editing) {
        const res = await updateProfessorTask(editing.origin_id, input)
        if (res.result !== 'updated') throw new Error('That task could not be changed.')
        const milestoneOk =
          milestoneId === (editing.milestone_id ?? '') ||
          (await applyMilestone(editing.origin_id, milestoneId))
        const saved = res.frozen
          ? `Updated ${res.changed} of ${(res.changed ?? 0) + res.frozen} copies — ${res.frozen} already started`
          : 'Task updated everywhere'
        await onSaved(milestoneOk ? saved : 'Task updated, but the milestone was not set. Try again.')
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
        const milestoneOk = !milestoneId || (await applyMilestone(res.origin_id, milestoneId))
        const sent = `Task sent to ${res.boards} ${res.boards === 1 ? 'group' : 'groups'}`
        await onSaved(
          milestoneOk ? sent : `${sent}, but the milestone was not set. Edit the task to try again.`,
        )
      }
      close()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save that task.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={editing ? 'Edit the task you set' : 'Set a task'}
      description={
        editing
          ? 'Changes reach only the groups that have not started theirs yet.'
          : 'You write it. The group decides who does it.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
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
          <label className="block space-y-2">
            <span className="text-[13px] font-medium text-ink">Who gets it</span>
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

        {milestones.length > 0 && (
          <label className="block space-y-2">
            <span className="text-[13px] font-medium text-ink">
              Counts toward <span className="font-normal text-faint">(optional)</span>
            </span>
            <Select
              value={milestoneId}
              onChange={(e) => setMilestoneId(e.target.value)}
              placeholder="No milestone"
              options={milestones.map((m) => ({ value: m.id, label: m.name }))}
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
