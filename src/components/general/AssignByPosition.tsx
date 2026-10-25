import { useEffect, useRef, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Input } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { KeepBox } from './TasksFromNotes'
import { assignTask, listTasks, updateTask } from '../../lib/api/general'
import { draftAssignees } from '../../lib/api/workAi'
import { authErrorMessage } from '../../lib/authError'
import { isAssignCandidate, planAssignSave, reasonText, rowsFromPicks, skippedMessage } from '../../lib/work/assignDraft'
import type { AssignRow } from '../../lib/work/assignDraft'
import type { GeneralProjectState } from './useGeneralProject'

const EMPTY = {
  no_tasks: 'Every open task already has someone on it.',
  no_structure: 'Add positions or skills on the Members tab first.',
} as const

/**
 * The AI drafts who holds each open task with nobody on it, by position or
 * skill tag; the pm or a coordinator keeps, edits or drops each pick, and
 * nothing is assigned until Save. Work projects only.
 */
export function AssignByPosition({ state, open, onClose }: { state: GeneralProjectState; open: boolean; onClose: () => void }) {
  const { show } = useToast()
  const [rows, setRows] = useState<AssignRow[] | null>(null)
  const [left, setLeft] = useState(0)
  const [empty, setEmpty] = useState<keyof typeof EMPTY | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Each draft spends one of the person's hourly AI calls, so a stale or
  // repeated run is dropped by number rather than started twice.
  const run = useRef(0)
  const started = useRef(false)
  const projectId = state.project?.id

  async function draft() {
    if (!projectId) return
    const id = ++run.current
    setBusy(true)
    setError(null)
    setRows(null)
    setEmpty(null)
    try {
      const res = await draftAssignees(projectId, { mode: 'tasks' })
      if (run.current !== id) return
      if (res.result !== 'ok') return setError(res.message)
      setLeft(res.left)
      if (res.empty) return setEmpty(res.empty)
      setRows(rowsFromPicks(res.picks))
    } catch (err) {
      if (run.current === id) setError(authErrorMessage(err, "Couldn't suggest people this time."))
    } finally {
      if (run.current === id) setBusy(false)
    }
  }

  useEffect(() => {
    if (!open) {
      run.current++
      started.current = false
      setRows(null)
      setLeft(0)
      setEmpty(null)
      setError(null)
      setBusy(false)
      return
    }
    if (started.current) return
    started.current = true
    void draft()
    // draft reads projectId; reopening is what starts a new run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function patch(taskId: string, next: Partial<AssignRow>) {
    setRows((list) => (list ?? []).map((r) => (r.taskId === taskId ? { ...r, ...next } : r)))
  }

  async function save() {
    if (!projectId || !rows) return
    setSaving(true)
    setError(null)
    try {
      const { apply, skipped } = planAssignSave(rows, await listTasks(projectId))
      let failed = 0
      for (const item of apply) {
        let ok = true
        if (item.title) {
          try {
            await updateTask(item.taskId, { title: item.title })
          } catch {
            ok = false
          }
        }
        for (const person of item.people) {
          try {
            await assignTask(item.taskId, projectId, person)
          } catch {
            ok = false
          }
        }
        if (!ok) failed++
      }
      await state.reload()
      show(
        ['Assignments saved.', skippedMessage(skipped), failed > 0 ? `${failed} could not be saved.` : '']
          .filter(Boolean)
          .join(' '),
        failed > 0 ? 'error' : undefined,
      )
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Assignments could not be saved. Try again.'))
    } finally {
      setSaving(false)
    }
  }

  const candidates = state.members.filter(isAssignCandidate)
  const changes = (rows ?? []).some((r) => r.keep && (r.people.length > 0 || (r.title.trim() && r.title.trim() !== r.originalTitle)))
  const keeping = (rows ?? []).filter((r) => r.keep).length

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Assign by position"
      description="Each open task with nobody on it is matched to a position or skill. Nothing is assigned until you save."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          {rows === null ? (
            error && (
              <Button onClick={() => void draft()} loading={busy} className="!rounded-xl">
                <Icon name="spark" size={16} />
                Try again
              </Button>
            )
          ) : (
            <Button onClick={() => void save()} loading={saving} disabled={!changes} className="!rounded-xl">
              Save assignments
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        {busy ? (
          <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Matching tasks to positions…
          </div>
        ) : empty ? (
          <p className="py-6 text-[14px] text-muted">{EMPTY[empty]}</p>
        ) : rows === null ? null : rows.length === 0 ? (
          <p className="py-6 text-[14px] text-muted">{EMPTY.no_tasks}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="eyebrow">
                {keeping} of {rows.length} {rows.length === 1 ? 'task' : 'tasks'} kept
              </p>
              {left > 0 && (
                <p className="text-[12px] text-faint">
                  {left === 1 ? '1 more task was left for the next run.' : `${left} more tasks were left for the next run.`}
                </p>
              )}
            </div>
            <ul className="space-y-3">
              {rows.map((r, i) => {
                const addable = candidates.filter((m) => !r.people.includes(m.user_id))
                return (
                  <li key={r.taskId} className={`rounded-xl border border-line p-3 ${r.keep ? '' : 'opacity-50'}`}>
                    <div className="flex items-start gap-3">
                      <KeepBox checked={r.keep} label={`Keep ${r.title}`} onToggle={() => patch(r.taskId, { keep: !r.keep })} />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-start">
                          <Input
                            value={r.title}
                            maxLength={200}
                            onChange={(e) => patch(r.taskId, { title: e.target.value })}
                            aria-label={`Task ${i + 1} name`}
                            className="!h-10 font-medium"
                          />
                          <div className="flex min-h-10 flex-wrap items-center gap-1.5">
                            {r.people.map((id) => (
                              <span key={id} className="flex items-center gap-1 rounded-lg surface-sunken py-1 pr-1 pl-2.5 text-[12px] text-ink">
                                <span className="max-w-[180px] truncate">{state.nameOf(id)}</span>
                                <button
                                  type="button"
                                  onClick={() => patch(r.taskId, { people: r.people.filter((x) => x !== id) })}
                                  aria-label={`Take ${state.nameOf(id)} off ${r.title}`}
                                  className="grid h-5 w-5 place-items-center rounded-full text-faint hover:text-ink"
                                >
                                  <Icon name="x" size={11} />
                                </button>
                              </span>
                            ))}
                            {addable.length > 0 && (
                              <Select
                                value=""
                                onChange={(e) => e.target.value && patch(r.taskId, { people: [...r.people, e.target.value] })}
                                placeholder="Add a person"
                                aria-label={`Add a person to task ${i + 1}`}
                                options={addable.map((m) => ({ value: m.user_id, label: state.nameOf(m.user_id) }))}
                                className="!h-8 !w-auto max-w-[220px] !text-[12px]"
                              />
                            )}
                          </div>
                        </div>
                        <p className={`text-[12px] ${r.kind === 'none' ? 'text-faint' : 'text-muted'}`}>{reasonText(r)}</p>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </Modal>
  )
}
