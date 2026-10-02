import { useEffect, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Input } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select, Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { listDiscussionFolders, listDiscussions } from '../../lib/api/discussions'
import { attachSharedFiles } from '../../lib/general/sharedFiles'
import { GENERAL_FILE_LIMIT, assignTask, createTask, uploadTaskFile } from '../../lib/api/general'
import { draftWorkTasks } from '../../lib/api/workAi'
import type { DraftSharedFile, DraftedWorkTask } from '../../lib/api/workAi'
import { authErrorMessage } from '../../lib/authError'
import { formatDue } from '../../lib/general/dates'
import type { GeneralProjectState } from './useGeneralProject'

export type NoteTaskRow = DraftedWorkTask & { keep: boolean }
type Row = NoteTaskRow
type Source = 'paste' | 'discussion'

/** 11:59 pm on a local `YYYY-MM-DD`, as ISO. Null for an empty or bad day. */
function endOfDay(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T23:59`).toISOString() : null
}

/**
 * Minutes, notes or a saved discussion in; the action items in them out, as
 * draft tasks to keep, edit or drop. Nothing is saved until the person says so.
 * Owners and dates are only what the text names; people are put on a task only
 * by someone who may assign them.
 *
 * A work project saves them as its own tasks. A class project passes `onSave`
 * (and `mayAssign`, since any student may hand a board task to a groupmate) and
 * saves them on the group's board instead.
 */
export function TasksFromNotes({
  state,
  open,
  onClose,
  onSave,
  mayAssign: mayAssignOverride,
}: {
  state: GeneralProjectState
  open: boolean
  onClose: () => void
  /** Saves the kept rows and returns what to tell the person. `shared` is what their `files` name. */
  onSave?: (rows: NoteTaskRow[], shared: DraftSharedFile[]) => Promise<string>
  mayAssign?: boolean
}) {
  const { show } = useToast()
  const [source, setSource] = useState<Source>('paste')
  const [text, setText] = useState('')
  const [discussionId, setDiscussionId] = useState('')
  const [files, setFiles] = useState<{ value: string; label: string }[] | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [note, setNote] = useState('')
  const [shared, setShared] = useState<DraftSharedFile[]>([])
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const projectId = state.project?.id
  const mayAssign = mayAssignOverride ?? state.can('manage_tasks')

  useEffect(() => {
    if (!open) {
      setRows(null)
      setNote('')
      setShared([])
      setError(null)
      setText('')
      setDiscussionId('')
      return
    }
    if (!projectId) return
    let live = true
    // Only stopped discussions have a file to read.
    void Promise.all([listDiscussions(projectId), listDiscussionFolders(projectId)])
      .then(
        ([list, folders]) =>
          live &&
          setFiles(
            list
              .filter((d) => d.ended_at)
              .map((d) => {
                const folder = folders.find((f) => f.id === d.folder_id)?.name
                return { value: d.id, label: `${folder ? `${folder} / ` : ''}${d.topic} · ${formatDue(d.started_at)}` }
              }),
          ),
      )
      .catch(() => live && setFiles([]))
    return () => {
      live = false
    }
  }, [open, projectId])

  async function draft() {
    if (!projectId) return
    if (source === 'paste' && text.trim().length < 20) return setError('Paste the notes first.')
    if (source === 'discussion' && !discussionId) return setError('Pick a discussion.')
    setBusy(true)
    setError(null)
    try {
      const res = await draftWorkTasks(projectId, source === 'paste' ? { text } : { discussion_id: discussionId })
      if (res.result !== 'ok') return setError(res.message)
      setRows(res.tasks.map((t) => ({ ...t, files: t.files ?? [], assignee: mayAssign ? t.assignee : '', keep: true })))
      setNote(res.note)
      setShared(res.shared ?? [])
    } catch (err) {
      setError(authErrorMessage(err, 'No draft could be produced. Try again in a moment.'))
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!projectId) return
    const keep = (rows ?? []).filter((r) => r.keep && r.title.trim())
    if (keep.length === 0) return
    setSaving(true)
    setError(null)
    if (onSave) {
      try {
        show(await onSave(keep, shared))
        onClose()
      } catch (err) {
        setError(authErrorMessage(err, 'Those tasks could not be saved.'))
      } finally {
        setSaving(false)
      }
      return
    }
    let unassigned = 0
    let missed = 0
    try {
      for (const r of keep) {
        const taskId = await createTask({
          projectId,
          title: r.title,
          description: r.description,
          dueAt: endOfDay(r.due),
          startsAt: null,
          teamId: state.teams.find((t) => t.name === r.team)?.id ?? null,
        })
        if (r.assignee) {
          try {
            await assignTask(taskId, projectId, r.assignee)
          } catch {
            unassigned++
          }
        }
        missed += await attachSharedFiles(r.files, shared, GENERAL_FILE_LIMIT, (file) =>
          uploadTaskFile(projectId, taskId, file),
        )
      }
      show(
        `${keep.length} ${keep.length === 1 ? 'task' : 'tasks'} added` +
          (unassigned > 0 ? `. ${unassigned} could not be given to the person named.` : '') +
          (missed > 0 ? `. ${missed} ${missed === 1 ? 'file' : 'files'} could not be added to ${missed === 1 ? 'its task' : 'their tasks'}.` : ''),
      )
      await state.reload()
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
  const people = state.members.map((m) => ({ value: m.user_id, label: state.nameOf(m.user_id) }))
  const teams = state.teams.map((t) => ({ value: t.name, label: t.name }))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tasks from notes"
      description="Paste minutes or notes, or pick a saved discussion, and keep the action items you want."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy || saving}>
            Cancel
          </Button>
          {rows === null ? (
            <Button onClick={() => void draft()} loading={busy} className="!rounded-xl">
              <Icon name="spark" size={16} />
              Find the tasks
            </Button>
          ) : (
            <Button onClick={() => void save()} loading={saving} disabled={keeping === 0} className="!rounded-xl">
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
            <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
              <Spinner size={16} />
              Reading for action items…
            </div>
          ) : (
            <>
              <div role="radiogroup" aria-label="Where the notes are" className="flex gap-2">
                {(['paste', 'discussion'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={source === s}
                    onClick={() => setSource(s)}
                    className={`rounded-lg border px-3 py-1.5 text-[13px] ${
                      source === s ? 'border-navy-400 bg-navy-50 font-medium text-ink dark:bg-navy-500/12' : 'border-line text-muted'
                    }`}
                  >
                    {s === 'paste' ? 'Paste notes' : 'From a discussion'}
                  </button>
                ))}
              </div>
              {source === 'paste' ? (
                <Textarea
                  rows={10}
                  maxLength={60000}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  aria-label="Notes"
                  placeholder="Paste meeting minutes, a chat excerpt or a to-do list."
                />
              ) : files === null ? (
                <p className="flex items-center gap-2 text-[13px] text-muted">
                  <Spinner size={14} /> Loading the discussions…
                </p>
              ) : files.length === 0 ? (
                <p className="text-[13px] text-muted">
                  No saved discussions yet. Start one in the Discussion tab and stop it to save its file,
                  or paste the notes instead.
                </p>
              ) : (
                <Select
                  value={discussionId}
                  onChange={(e) => setDiscussionId(e.target.value)}
                  placeholder="Choose a discussion"
                  aria-label="Discussion to read"
                  options={files}
                />
              )}
              <p className="text-[12px] text-faint">
                Owners and dates come only from what the text says. Nothing is added until you choose.
              </p>
            </>
          )
        ) : rows.length === 0 ? (
          <p className="py-6 text-[14px] text-muted">{note || 'No action items were found in that text.'}</p>
        ) : (
          <>
            {note && (
              <p className="flex items-start gap-2 rounded-xl border border-line surface-sunken px-3.5 py-3 text-[13px] text-muted">
                <Icon name="info" size={15} className="mt-px shrink-0" />
                {note}
              </p>
            )}
            {!mayAssign && (
              <p className="text-[12px] text-faint">
                Putting people on tasks needs the Manage tasks permission, so these are added with nobody on them.
              </p>
            )}
            <ul className="space-y-3">
              {rows.map((r, i) => (
                <li key={i} className={`rounded-xl border border-line p-3 ${r.keep ? '' : 'opacity-50'}`}>
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={r.keep}
                      aria-label={`Keep ${r.title}`}
                      onClick={() => patch(i, { keep: !r.keep })}
                      className={`mt-2.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border ${
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
                      {r.description && (
                        <Textarea
                          rows={2}
                          value={r.description}
                          onChange={(e) => patch(i, { description: e.target.value })}
                          aria-label={`Task ${i + 1} details`}
                          className="!text-[13px]"
                        />
                      )}
                      {shared.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {r.files.length > 0 && <span className="text-[12px] text-faint">Adds to its Files:</span>}
                          {r.files.map((id) => {
                            const f = shared.find((x) => x.id === id)
                            if (!f) return null
                            return (
                              <span key={id} className="flex items-center gap-1.5 rounded-lg surface-sunken py-1 pr-1 pl-2 text-[12px] text-ink">
                                <Icon name="file" size={12} className="text-muted" />
                                <span className="max-w-[180px] truncate">{f.name}</span>
                                <button
                                  type="button"
                                  onClick={() => patch(i, { files: r.files.filter((x) => x !== id) })}
                                  aria-label={`Do not add ${f.name} to this task`}
                                  className="grid h-5 w-5 place-items-center rounded-full text-faint hover:text-ink"
                                >
                                  <Icon name="x" size={11} />
                                </button>
                              </span>
                            )
                          })}
                          {/* The model links a file only when the discussion says so; this is for when it missed one. */}
                          {shared.some((f) => !r.files.includes(f.id)) && (
                            <Select
                              value=""
                              onChange={(e) => e.target.value && patch(i, { files: [...r.files, e.target.value] })}
                              placeholder="Add a shared file…"
                              aria-label={`Add a shared file to task ${i + 1}`}
                              options={shared
                                .filter((f) => !r.files.includes(f.id))
                                .map((f) => ({ value: f.id, label: f.name }))}
                              className="!h-8 !w-auto max-w-[240px] !text-[12px]"
                            />
                          )}
                        </div>
                      )}
                      <div className="grid gap-2 sm:grid-cols-3">
                        <Input
                          type="date"
                          value={r.due}
                          onChange={(e) => patch(i, { due: e.target.value })}
                          aria-label={`Task ${i + 1} due date`}
                          className="!h-10 !text-[13px]"
                        />
                        {mayAssign && (
                          <Select
                            value={r.assignee}
                            onChange={(e) => patch(i, { assignee: e.target.value })}
                            placeholder="Nobody yet"
                            aria-label={`Task ${i + 1} person`}
                            options={people}
                            className="!h-10 !text-[13px]"
                          />
                        )}
                        {teams.length > 0 && (
                          <Select
                            value={r.team}
                            onChange={(e) => patch(i, { team: e.target.value })}
                            placeholder="No team"
                            aria-label={`Task ${i + 1} team`}
                            options={teams}
                            className="!h-10 !text-[13px]"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  )
}
