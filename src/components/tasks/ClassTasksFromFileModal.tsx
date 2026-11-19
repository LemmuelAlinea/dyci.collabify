import { useEffect, useRef, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Badge, type BadgeTone } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Input } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select, Textarea } from '../ui/Select'
import { createProfessorTask, generateTasksFromFile } from '../../lib/api/tasks'
import { authErrorMessage } from '../../lib/authError'
import { alreadySetTitles, fileRows, fitLabel, retarget, type FileRow } from '../../lib/classFileTasks'
import { NOTES_FILE_ACCEPT, NotesFileError, readNotesFile } from '../../lib/general/notesFile'
import { endOfDay } from '../../lib/taskPlan'
import { boardOwnerName } from '../../lib/types'
import type { BoardSummary, ProjectSummary, ProjectTask } from '../../lib/types'

const LABEL_TONE: Record<ReturnType<typeof fitLabel>, BadgeTone> = {
  Fits: 'success',
  "Doesn't fit": 'warning',
  'Already set': 'pending',
}

/**
 * A professor's task file, drafted into the tasks they set. Each task is
 * checked against the project's guidelines, rubric and weeks: one that does not
 * fit, or that the chosen groups already have, starts unticked, never dropped.
 */
export function ClassTasksFromFileModal({
  open,
  onClose,
  project,
  boards,
  rows: setRows,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  project: ProjectSummary
  boards: BoardSummary[]
  /** Every task on the project's boards, for what is already set. */
  rows: ProjectTask[]
  onSaved: (message: string) => Promise<void>
}) {
  const [rows, setRowsState] = useState<FileRow[] | null>(null)
  const [note, setNote] = useState('')
  const [target, setTarget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const generation = useRef(0)

  useEffect(() => {
    if (open) return
    generation.current++
    setRowsState(null)
    setNote('')
    setTarget('')
    setError(null)
    setBusy(false)
  }, [open])

  async function upload(file: File) {
    const token = ++generation.current
    setError(null)
    setRowsState(null)
    setNote('')
    setBusy(true)
    try {
      const { text } = await readNotesFile(file)
      if (token !== generation.current) return
      const res = await generateTasksFromFile(project.id, text, file.name)
      if (token !== generation.current) return
      if (res.result !== 'ok') return setError(res.message)
      setRowsState(fileRows(res.tasks, alreadySetTitles(setRows, boards.length, target)))
      setNote(res.note)
    } catch (err) {
      if (token !== generation.current) return
      setError(err instanceof NotesFileError ? err.message : authErrorMessage(err, 'The file could not be drafted. Try again.'))
    } finally {
      if (token === generation.current) setBusy(false)
    }
  }

  function changeTarget(next: string) {
    setTarget(next)
    setRowsState((list) => (list ? retarget(list, alreadySetTitles(setRows, boards.length, next)) : list))
  }

  function patch(i: number, next: Partial<FileRow>) {
    setRowsState((list) => (list ?? []).map((r, n) => (n === i ? { ...r, ...next } : r)))
  }

  const keep = (rows ?? []).filter((r) => r.keep && r.title.trim())

  async function save() {
    if (keep.length === 0) return
    setSaving(true)
    setError(null)
    let added = 0
    try {
      for (const row of keep) {
        await createProfessorTask({
          projectId: project.id,
          title: row.title.trim(),
          details: row.details,
          weight: row.weight,
          dueAt: endOfDay(row.due),
          boardId: target || null,
          aiGenerated: true,
        })
        added++
      }
      await onSaved(`${added} ${added === 1 ? 'task' : 'tasks'} added`)
      onClose()
    } catch (err) {
      setError(
        authErrorMessage(err, 'Those tasks could not be saved.') +
          (added > 0 ? ` ${added} ${added === 1 ? 'was' : 'were'} added before it stopped; untick ${added === 1 ? 'it' : 'them'} before trying again.` : ''),
      )
      if (added > 0) await onSaved(`${added} ${added === 1 ? 'task' : 'tasks'} added`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!saving) onClose()
      }}
      title="Tasks from a file"
      description="Each task is checked against this project's guidelines, rubric and syllabus weeks."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          {rows && rows.length > 0 && (
            <Button onClick={save} loading={saving} disabled={keep.length === 0 || busy} className="!rounded-xl">
              Add {keep.length} {keep.length === 1 ? 'task' : 'tasks'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <label className="block space-y-2">
          <span className="text-[13px] font-medium text-ink">Task file</span>
          <input
            type="file"
            accept={NOTES_FILE_ACCEPT}
            disabled={busy || saving}
            className="block w-full rounded-xl border border-line p-3 text-[13px]"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0]
              e.currentTarget.value = ''
              if (file) void upload(file)
            }}
          />
          <span className="block text-[12px] text-faint">
            A PDF, Word, Excel, CSV or text file that lists the tasks. Only its text goes to the AI; the file is not saved.
          </span>
        </label>

        {error && <Alert tone="error">{error}</Alert>}

        {busy ? (
          <div role="status" className="flex items-center gap-3 py-6 text-[14px] text-muted">
            <Spinner size={16} />
            Reading the file and checking each task against the project…
          </div>
        ) : rows === null ? null : rows.length === 0 ? (
          <p className="py-4 text-[14px] text-muted">{note || 'No tasks were found in that file. Upload the one with the tasks in it.'}</p>
        ) : (
          <>
            {note && (
              <p className="flex items-start gap-2 rounded-xl border border-line surface-sunken px-3.5 py-3 text-[13px] text-muted">
                <Icon name="info" size={15} className="mt-px shrink-0" />
                {note}
              </p>
            )}

            <ul className="space-y-3">
              {rows.map((r, i) => {
                const label = fitLabel(r)
                return (
                  <li key={i} data-file-task className={`rounded-xl border border-line p-3 transition-colors ${r.keep ? '' : 'opacity-70'}`}>
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={r.keep}
                        aria-label={`Keep ${r.title}`}
                        onClick={() => patch(i, { keep: !r.keep })}
                        className={`mt-2.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors ${
                          r.keep
                            ? 'border-navy-600 bg-navy-600 text-white dark:border-navy-400 dark:bg-navy-400'
                            : 'border-[var(--line-strong)]'
                        }`}
                      >
                        {r.keep && <Icon name="check" size={13} strokeWidth={3} />}
                      </button>
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <Input
                            value={r.title}
                            onChange={(e) => patch(i, { title: e.target.value })}
                            aria-label={`Task ${i + 1} name`}
                            className="!h-10 font-medium"
                          />
                          <span data-fit-label className="shrink-0 self-start sm:self-center">
                            <Badge tone={LABEL_TONE[label]}>{label}</Badge>
                          </span>
                        </div>
                        {r.fit === 'off' && r.fit_reason && <p className="text-[12px] text-muted">{r.fit_reason}</p>}
                        <Textarea
                          rows={2}
                          value={r.details}
                          onChange={(e) => patch(i, { details: e.target.value })}
                          aria-label={`Task ${i + 1} details`}
                          className="!text-[13px]"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="w-full sm:w-[170px]">
                            <Input
                              type="date"
                              value={r.due}
                              onChange={(e) => patch(i, { due: e.target.value })}
                              aria-label={`Task ${i + 1} due date`}
                              className="!h-10 !text-[13px]"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={1}
                              max={20}
                              value={r.weight}
                              onChange={(e) => patch(i, { weight: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
                              aria-label={`Task ${i + 1} weight`}
                              className="!h-10 !w-[70px] text-center"
                            />
                            <span className="text-[12px] text-faint">weight</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <label className="block space-y-2 sm:w-[280px]">
                <span className="text-[13px] font-medium text-ink">Who gets them</span>
                <Select
                  aria-label="Who gets them"
                  value={target}
                  onChange={(e) => changeTarget(e.target.value)}
                  placeholder={`Every group (${boards.length})`}
                  options={boards.map((b) => ({ value: b.id, label: boardOwnerName(b) }))}
                />
              </label>
              <p className="text-[13px] text-muted">
                {keep.length} of {rows.length} will be added.
              </p>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
