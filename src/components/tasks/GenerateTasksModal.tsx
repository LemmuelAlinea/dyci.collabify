import { useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { Alert, Input } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select, Textarea } from '../ui/Select'
import { addTask, createProfessorTask, generateTasks } from '../../lib/api/tasks'
import type { TaskDraft } from '../../lib/api/tasks'
import { authErrorMessage } from '../../lib/authError'
import type { BoardSummary, ProjectSummary, Role } from '../../lib/types'

type Row = TaskDraft & { keep: boolean }

/**
 * A draft, never a decision. The model reads the brief, the rubric, and the
 * weeks the project is built on; the person keeps what is right, edits the
 * wording, and drops the rest. Nothing is saved until they say so.
 */
export function GenerateTasksModal({
  open,
  onClose,
  project,
  board,
  boards,
  role,
  viewerId,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  project: ProjectSummary
  /** The board the tasks land on, for a student. */
  board: BoardSummary | null
  /** Every board, for a professor choosing who gets them. */
  boards: BoardSummary[]
  role: Role
  viewerId: string | undefined
  onSaved: (message: string) => Promise<void> | void
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [note, setNote] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isProfessor = role === 'professor'

  useEffect(() => {
    if (!open) {
      setRows(null)
      setNote('')
      setError(null)
      setTarget('')
    }
  }, [open])

  async function draft() {
    setError(null)
    setBusy(true)
    try {
      const res = await generateTasks(project.id, isProfessor ? null : (board?.id ?? null))
      if (res.result !== 'ok') {
        setError(res.message ?? 'No draft could be produced.')
        setRows([])
        return
      }
      setRows((res.tasks ?? []).map((t) => ({ ...t, keep: true })))
      setNote(res.note ?? '')
    } catch (err) {
      setError(authErrorMessage(err, 'The draft could not be produced.'))
      setRows([])
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    const keep = (rows ?? []).filter((r) => r.keep && r.title.trim())
    if (keep.length === 0 || !viewerId) return
    setSaving(true)
    setError(null)
    try {
      for (const row of keep) {
        if (isProfessor) {
          await createProfessorTask({
            projectId: project.id,
            title: row.title,
            details: row.details,
            weight: row.weight,
            dueAt: null,
            boardId: target || null,
            aiGenerated: true,
          })
        } else if (board) {
          await addTask(
            board.id,
            { title: row.title, details: row.details, weight: row.weight, dueAt: null },
            viewerId,
            true,
          )
        }
      }
      await onSaved(`${keep.length} ${keep.length === 1 ? 'task' : 'tasks'} added`)
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Those tasks could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  function patch(i: number, next: Partial<Row>) {
    setRows((list) => (list ?? []).map((r, n) => (n === i ? { ...r, ...next } : r)))
  }

  const keeping = (rows ?? []).filter((r) => r.keep).length

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Draft tasks with AI"
      description="Built from this project's brief, rubric, and the syllabus weeks behind it."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy || saving}>
            Cancel
          </Button>
          {rows === null ? (
            <Button onClick={draft} loading={busy} className="!rounded-xl">
              <Icon name="spark" size={16} />
              Draft them
            </Button>
          ) : (
            <Button
              onClick={save}
              loading={saving}
              disabled={keeping === 0}
              className="!rounded-xl"
            >
              Add {keeping} {keeping === 1 ? 'task' : 'tasks'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        {rows === null ? (
          busy ? (
            <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
              <Spinner size={16} />
              Reading the brief and the weeks it is based on…
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[14px] leading-relaxed text-muted">
                This reads <strong className="text-ink">{project.title}</strong> — the
                guidelines, the rubric, and weeks {project.start_week}–{project.end_week} of
                the syllabus — and suggests how to break it up.
              </p>
              <p className="text-[13px] leading-relaxed text-faint">
                Nothing is saved until you choose. Every suggestion can be edited or dropped,
                and you can add your own tasks either way.
              </p>
            </div>
          )
        ) : rows.length === 0 ? (
          <p className="py-6 text-[14px] text-muted">
            {note || 'Nothing could be drafted from this brief. Write the tasks by hand.'}
          </p>
        ) : (
          <>
            {note && (
              <p className="flex items-start gap-2 rounded-xl border border-line surface-sunken px-3.5 py-3 text-[13px] text-muted">
                <Icon name="info" size={15} className="mt-px shrink-0" />
                {note}
              </p>
            )}

            <ul className="space-y-2.5">
              {rows.map((r, i) => (
                <li
                  key={i}
                  className={`rounded-xl border p-3 transition-colors ${
                    r.keep ? 'border-line' : 'border-line opacity-50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={r.keep}
                      aria-label={`Keep ${r.title}`}
                      onClick={() => patch(i, { keep: !r.keep })}
                      className={`mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors ${
                        r.keep
                          ? 'border-navy-600 bg-navy-600 text-white dark:border-navy-400 dark:bg-navy-400'
                          : 'border-[var(--line-strong)]'
                      }`}
                    >
                      {r.keep && <Icon name="check" size={13} strokeWidth={3} />}
                    </button>

                    <div className="min-w-0 flex-1 space-y-2">
                      <Input
                        value={r.title}
                        onChange={(e) => patch(i, { title: e.target.value })}
                        aria-label={`Task ${i + 1} name`}
                        className="!h-10 font-medium"
                      />
                      <Textarea
                        rows={2}
                        value={r.details}
                        onChange={(e) => patch(i, { details: e.target.value })}
                        aria-label={`Task ${i + 1} details`}
                        className="!text-[13.5px]"
                      />
                    </div>

                    <div className="w-[70px] shrink-0">
                      <Input
                        type="number"
                        min={1}
                        max={20}
                        value={r.weight}
                        onChange={(e) =>
                          patch(i, {
                            weight: Math.max(1, Math.min(20, Number(e.target.value) || 1)),
                          })
                        }
                        aria-label={`Task ${i + 1} weight`}
                        className="!h-10 text-center"
                      />
                      <p className="mt-1 text-center text-[11px] text-faint">weight</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {isProfessor && (
              <label className="block space-y-1.5">
                <span className="text-[13.5px] font-medium text-ink">Who gets them</span>
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

            <p className="text-[12.5px] leading-relaxed text-faint">
              Weights are relative. Once added, these sit alongside your other tasks and the
              board still totals 100.
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}
