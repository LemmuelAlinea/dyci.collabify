import { useEffect, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Input } from '../ui/Field'
import { FileDrop } from '../ui/FileDrop'
import { Icon, Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select, Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { listDiscussionFolders, listDiscussions } from '../../lib/api/discussions'
import { attachSharedFiles } from '../../lib/general/sharedFiles'
import { GENERAL_FILE_LIMIT, assignTask, createTask, uploadTaskFile } from '../../lib/api/general'
import { createMilestone, tagTasks } from '../../lib/api/milestones'
import { createSprint, setSprintMilestone } from '../../lib/api/sprints'
import { draftWorkTasks } from '../../lib/api/workAi'
import type { DraftSharedFile, DraftedWorkTask } from '../../lib/api/workAi'
import { authErrorMessage } from '../../lib/authError'
import { formatDue } from '../../lib/general/dates'
import { NOTES_FILE_ACCEPT, NOTES_FILE_MAX, NotesFileError, readNotesFile } from '../../lib/general/notesFile'
import {
  addedMessage,
  byMilestone,
  commitPlan,
  endOfDay,
  planProblem,
  resolveKey,
  shapePlan,
  sprintMilestone,
  startOfDay,
} from '../../lib/work/notesPlan'
import type { PlanMilestone, PlanSprint } from '../../lib/work/notesPlan'
import type { Milestone, Sprint } from '../../lib/work/types'
import type { GeneralProjectState } from './useGeneralProject'

/** A drafted task, plus the sprint and milestone it joins (keys from lib/work/notesPlan). */
export type NoteTaskRow = DraftedWorkTask & { keep: boolean; sprintKey: string; milestoneKey: string }
/** The sprints and milestones the draft would create. */
export type NotePlan = { sprints: PlanSprint[]; milestones: PlanMilestone[] }
type Row = NoteTaskRow
type Source = 'paste' | 'file' | 'discussion'

/** Where the drafted sprints and milestones go, and what this viewer may do with them. */
export type NotesPlanScope = {
  sprints: Sprint[]
  milestones: Milestone[]
  maySprint: boolean
  mayCreateMilestones: boolean
  /** May put tasks on a milestone that already exists. */
  mayTag: boolean
  /** Said when the draft found sprints this viewer may not make. */
  noSprints: string
  /** Said when the draft found milestones this viewer may not make. */
  noMilestones: string
}

const SOURCES: { value: Source; label: string }[] = [
  { value: 'paste', label: 'Paste notes' },
  { value: 'file', label: 'Upload a file' },
  { value: 'discussion', label: 'From a discussion' },
]

/** The start, unless it falls after the due day (the table refuses that). */
function startsAt(r: Row) {
  return r.start && (!r.due || r.start <= r.due) ? startOfDay(r.start) : null
}

/**
 * Minutes, notes, an uploaded file or a saved discussion in; the action items
 * in them out, as draft tasks to keep, edit or drop. When the text lays out
 * sprints or milestones, those are drafted too and the tasks put in them; a
 * task with no sprint goes to the backlog. Nothing is saved until the person
 * says so. Owners and dates are only what the text names; people are put on a
 * task only by someone who may assign them.
 *
 * A work project saves them as its own tasks, sprints and milestones. A class
 * project passes `onSave` and `plan` (and `mayAssign`, since any student may
 * hand a board task to a groupmate) and saves them on the group's board.
 */
export function TasksFromNotes({
  state,
  open,
  onClose,
  onSave,
  plan: planOverride,
  mayAssign: mayAssignOverride,
}: {
  state: GeneralProjectState
  open: boolean
  onClose: () => void
  /** Saves the kept rows and plan and returns what to tell the person. `shared` is what their `files` name. */
  onSave?: (rows: NoteTaskRow[], shared: DraftSharedFile[], plan: NotePlan) => Promise<string>
  plan?: NotesPlanScope
  mayAssign?: boolean
}) {
  const { show } = useToast()
  const [source, setSource] = useState<Source>('paste')
  const [text, setText] = useState('')
  const [upload, setUpload] = useState<File | null>(null)
  const [uploadText, setUploadText] = useState('')
  const [uploadCut, setUploadCut] = useState(false)
  const [reading, setReading] = useState(false)
  const [discussionId, setDiscussionId] = useState('')
  const [files, setFiles] = useState<{ value: string; label: string }[] | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [sprints, setSprints] = useState<PlanSprint[]>([])
  const [milestones, setMilestones] = useState<PlanMilestone[]>([])
  const [planNotes, setPlanNotes] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [shared, setShared] = useState<DraftSharedFile[]>([])
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const projectId = state.project?.id
  const mayAssign = mayAssignOverride ?? state.can('manage_tasks')
  const workPlans = Boolean(state.project) && !state.archived && state.can('manage_tasks')
  const scope: NotesPlanScope = planOverride ?? {
    sprints: state.sprints,
    milestones: state.milestones,
    maySprint: workPlans,
    mayCreateMilestones: workPlans,
    mayTag: workPlans,
    noSprints: 'Sprints need the Manage tasks permission, so the tasks from the file go to the backlog.',
    noMilestones: 'Milestones need the Manage tasks permission, so the ones in the file were left out.',
  }

  useEffect(() => {
    if (!open) {
      setRows(null)
      setSprints([])
      setMilestones([])
      setPlanNotes([])
      setNote('')
      setShared([])
      setError(null)
      setText('')
      setUpload(null)
      setUploadText('')
      setUploadCut(false)
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

  async function pick(file: File | null) {
    setUpload(file)
    setUploadText('')
    setUploadCut(false)
    setError(null)
    if (!file) return
    setReading(true)
    try {
      const { text: read, cut } = await readNotesFile(file)
      setUploadText(read)
      setUploadCut(cut)
    } catch (err) {
      setUpload(null)
      setError(err instanceof NotesFileError ? err.message : 'That file could not be read. Try another, or paste the tasks.')
    } finally {
      setReading(false)
    }
  }

  async function draft() {
    if (!projectId) return
    if (source === 'paste' && text.trim().length < 20) return setError('Paste the notes first.')
    if (source === 'file' && !uploadText) return setError('Upload a file first.')
    if (source === 'discussion' && !discussionId) return setError('Pick a discussion.')
    setBusy(true)
    setError(null)
    try {
      const res = await draftWorkTasks(
        projectId,
        source === 'paste'
          ? { text }
          : source === 'file'
            ? { text: uploadText, file_name: upload?.name ?? '' }
            : { discussion_id: discussionId },
      )
      if (res.result !== 'ok') return setError(res.message)
      const tasks = res.tasks.map((t) => ({ ...t, start: t.start ?? '', sprint: t.sprint ?? '', milestone: t.milestone ?? '' }))
      const shaped = shapePlan(
        { tasks, sprints: res.sprints, milestones: res.milestones },
        { sprints: scope.sprints, milestones: scope.milestones },
        { sprints: scope.maySprint, createMilestones: scope.mayCreateMilestones, tag: scope.mayTag },
      )
      setRows(
        tasks.map((t, i) => ({
          ...t,
          files: t.files ?? [],
          assignee: mayAssign ? t.assignee : '',
          keep: true,
          sprintKey: shaped.links[i].sprint,
          milestoneKey: shaped.links[i].milestone,
        })),
      )
      setSprints(shaped.sprints)
      setMilestones(shaped.milestones)
      const said: string[] = []
      if ((res.sprints?.length ?? 0) > 0 && !scope.maySprint) said.push(scope.noSprints)
      if (shaped.reused > 0) {
        said.push(
          shaped.reused === 1
            ? 'One sprint in the file is already here, so its tasks join it.'
            : `${shaped.reused} sprints in the file are already here, so their tasks join them.`,
        )
      }
      if (((res.milestones?.length ?? 0) > 0 && !scope.mayTag) || shaped.skippedMilestones > 0) said.push(scope.noMilestones)
      setPlanNotes(said)
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
    const problem = planProblem(sprints, milestones)
    if (problem) return setError(problem)
    setSaving(true)
    setError(null)
    if (onSave) {
      try {
        show(await onSave(keep, shared, { sprints, milestones }))
        onClose()
      } catch (err) {
        setError(authErrorMessage(err, 'Those tasks could not be saved.'))
      } finally {
        setSaving(false)
      }
      return
    }
    const home = { kind: 'work', projectId } as const
    let unassigned = 0
    let missed = 0
    let untagged = 0
    try {
      const created = await commitPlan(sprints, milestones, {
        sprint: (input, milestoneId) => createSprint(home, input, milestoneId),
        milestone: (input) => createMilestone(home, input),
        link: (sprintId, milestoneId) => setSprintMilestone(home, sprintId, milestoneId),
      })
      const tagged: { taskId: string; milestoneId: string | null }[] = []
      for (const r of keep) {
        const taskId = await createTask({
          projectId,
          title: r.title,
          description: r.description,
          dueAt: endOfDay(r.due),
          startsAt: startsAt(r),
          teamId: state.teams.find((t) => t.name === r.team)?.id ?? null,
          sprintId: resolveKey(r.sprintKey, created),
        })
        tagged.push({ taskId, milestoneId: resolveKey(milestoneOf(r), created) })
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
      for (const [milestoneId, ids] of byMilestone(tagged)) {
        try {
          await tagTasks(home, ids, milestoneId)
        } catch {
          untagged += ids.length
        }
      }
      show(
        addedMessage(keep.length, sprints.filter((s) => s.keep).length, milestones.filter((m) => m.keep).length) +
          (unassigned > 0 ? `. ${unassigned} could not be given to the person named.` : '') +
          (missed > 0 ? `. ${missed} ${missed === 1 ? 'file' : 'files'} could not be added to ${missed === 1 ? 'its task' : 'their tasks'}.` : '') +
          (untagged > 0 ? `. ${untagged} could not be put on their milestone; tag them from Milestones.` : ''),
      )
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Those tasks could not be saved.'))
    } finally {
      // Reload even after a failure: a partly saved plan still changed rows.
      await state.reload()
      setSaving(false)
    }
  }

  function patch(i: number, next: Partial<Row>) {
    setRows((list) => (list ?? []).map((r, n) => (n === i ? { ...r, ...next } : r)))
  }
  function patchSprint(key: string, next: Partial<PlanSprint>) {
    setSprints((list) => list.map((s) => (s.key === key ? { ...s, ...next } : s)))
  }
  function patchMilestone(key: string, next: Partial<PlanMilestone>) {
    setMilestones((list) => list.map((m) => (m.key === key ? { ...m, ...next } : m)))
  }
  /** A sprint counts toward one milestone, so adding it here takes it off any other. */
  function addSprintTo(key: string, sprintKey: string) {
    setMilestones((list) =>
      list.map((m) =>
        m.key === key ? { ...m, sprints: [...m.sprints, sprintKey] } : { ...m, sprints: m.sprints.filter((x) => x !== sprintKey) },
      ),
    )
  }
  /**
   * The milestone a task ends up counting toward: its own pick, else the one
   * its sprint counts toward (in this plan, or already), as the database does.
   */
  function milestoneOf(r: Row) {
    return (
      r.milestoneKey ||
      sprintMilestone(r.sprintKey, milestones) ||
      (scope.sprints.find((s) => s.id === r.sprintKey)?.milestone_id ?? '')
    )
  }

  const keeping = (rows ?? []).filter((r) => r.keep).length
  const people = state.members.map((m) => ({ value: m.user_id, label: state.nameOf(m.user_id) }))
  const teams = state.teams.map((t) => ({ value: t.name, label: t.name }))
  const sprintOptions = [
    ...scope.sprints.filter((s) => s.state !== 'completed').map((s) => ({ value: s.id, label: s.name })),
    ...sprints.filter((s) => s.keep).map((s) => ({ value: s.key, label: `${s.name || 'Unnamed sprint'} (new)` })),
  ]
  const milestoneOptions = [
    ...scope.milestones.map((m) => ({ value: m.id, label: m.name })),
    ...milestones.filter((m) => m.keep).map((m) => ({ value: m.key, label: `${m.name || 'Unnamed milestone'} (new)` })),
  ]
  // A row pointing at a new sprint or milestone that was left out reads as none.
  const shown = (key: string, options: { value: string }[]) => (options.some((o) => o.value === key) ? key : '')
  const inSprint = (key: string) => (rows ?? []).filter((r) => r.keep && r.sprintKey === key).length
  const inMilestone = (key: string) => (rows ?? []).filter((r) => r.keep && milestoneOf(r) === key).length
  const sprintName = (key: string) => sprintOptions.find((o) => o.value === key)?.label ?? ''

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tasks from notes"
      description="Paste minutes or notes, upload a task list or sprint plan, or pick a saved discussion, and keep what you want."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy || saving}>
            Cancel
          </Button>
          {rows === null ? (
            <Button onClick={() => void draft()} loading={busy} disabled={reading} className="!rounded-xl">
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
              {source === 'file' ? 'Reading the file for tasks, sprints and milestones…' : 'Reading for action items…'}
            </div>
          ) : (
            <>
              <div role="radiogroup" aria-label="Where the notes are" className="flex flex-wrap gap-2">
                {SOURCES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    role="radio"
                    aria-checked={source === s.value}
                    onClick={() => {
                      setSource(s.value)
                      setError(null)
                    }}
                    className={`rounded-lg border px-3 py-1.5 text-[13px] ${
                      source === s.value ? 'border-navy-400 bg-navy-50 font-medium text-ink dark:bg-navy-500/12' : 'border-line text-muted'
                    }`}
                  >
                    {s.label}
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
              ) : source === 'file' ? (
                <div className="space-y-2">
                  <FileDrop
                    file={upload}
                    onPick={(f) => void pick(f)}
                    accept={NOTES_FILE_ACCEPT}
                    maxSize={NOTES_FILE_MAX}
                    hint={`A task list or sprint plan · PDF, Word, Excel, CSV or text · up to ${NOTES_FILE_MAX} MB`}
                  />
                  {reading ? (
                    <p className="flex items-center gap-2 text-[13px] text-muted">
                      <Spinner size={14} /> Opening the file…
                    </p>
                  ) : (
                    uploadText && (
                      <p className="text-[12px] text-faint">
                        {uploadCut
                          ? 'The file is long, so only its first part is read.'
                          : 'File read. Find the tasks to see what is in it.'}
                      </p>
                    )
                  )}
                </div>
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
                Owners and dates come only from what the text says. Sprints and milestones are drafted
                only when the text names them; any other task goes to the backlog. Nothing is added
                until you choose.
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
            {planNotes.map((n) => (
              <p key={n} className="text-[12px] text-faint">
                {n}
              </p>
            ))}

            {sprints.length > 0 && (
              <section aria-label="Sprints to create" className="space-y-2">
                <p className="eyebrow">Sprints</p>
                <ul className="space-y-2">
                  {sprints.map((s) => (
                    <li key={s.key} className={`rounded-xl border border-line p-3 ${s.keep ? '' : 'opacity-50'}`}>
                      <div className="flex items-start gap-3">
                        <KeepBox checked={s.keep} label={`Keep ${s.name}`} onToggle={() => patchSprint(s.key, { keep: !s.keep })} />
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <Input
                                value={s.name}
                                maxLength={80}
                                onChange={(e) => patchSprint(s.key, { name: e.target.value })}
                                aria-label="Sprint name"
                                className="!h-10 font-medium"
                              />
                            </div>
                            <span className="shrink-0 font-mono text-[12px] text-faint">
                              {inSprint(s.key)} {inSprint(s.key) === 1 ? 'task' : 'tasks'}
                            </span>
                          </div>
                          <Input
                            value={s.goal}
                            maxLength={500}
                            onChange={(e) => patchSprint(s.key, { goal: e.target.value })}
                            aria-label={`${s.name} goal`}
                            placeholder="Goal (optional)"
                            className="!h-10 !text-[13px]"
                          />
                          <div className="grid gap-2 sm:grid-cols-2">
                            <DateField label="Starts" value={s.startsOn} aria={`${s.name} start date`} onChange={(v) => patchSprint(s.key, { startsOn: v })} />
                            <DateField label="Ends" value={s.endsOn} aria={`${s.name} end date`} onChange={(v) => patchSprint(s.key, { endsOn: v })} />
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {milestones.length > 0 && (
              <section aria-label="Milestones to create" className="space-y-2">
                <p className="eyebrow">Milestones</p>
                <ul className="space-y-2">
                  {milestones.map((m) => (
                    <li key={m.key} className={`rounded-xl border border-line p-3 ${m.keep ? '' : 'opacity-50'}`}>
                      <div className="flex items-start gap-3">
                        <KeepBox checked={m.keep} label={`Keep ${m.name}`} onToggle={() => patchMilestone(m.key, { keep: !m.keep })} />
                        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_180px]">
                          <Input
                            value={m.name}
                            maxLength={80}
                            onChange={(e) => patchMilestone(m.key, { name: e.target.value })}
                            aria-label="Milestone name"
                            className="!h-10 font-medium"
                          />
                          <Input
                            type="date"
                            value={m.dueOn}
                            onChange={(e) => patchMilestone(m.key, { dueOn: e.target.value })}
                            aria-label={`${m.name} date`}
                            className="!h-10 !text-[13px]"
                          />
                          <p className="font-mono text-[12px] text-faint sm:col-span-2">
                            {inMilestone(m.key)} {inMilestone(m.key) === 1 ? 'task counts' : 'tasks count'} toward it
                          </p>
                          {scope.maySprint && sprintOptions.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 sm:col-span-2">
                              {m.sprints
                                .filter((k) => sprintName(k))
                                .map((k) => (
                                  <span key={k} className="flex items-center gap-1 rounded-lg surface-sunken py-1 pr-1 pl-2.5 text-[12px] text-ink">
                                    {sprintName(k)}
                                    <button
                                      type="button"
                                      onClick={() => patchMilestone(m.key, { sprints: m.sprints.filter((x) => x !== k) })}
                                      aria-label={`Stop counting ${sprintName(k)} toward ${m.name}`}
                                      className="grid h-5 w-5 place-items-center rounded-full text-faint hover:text-ink"
                                    >
                                      <Icon name="x" size={11} />
                                    </button>
                                  </span>
                                ))}
                              {sprintOptions.some((o) => !m.sprints.includes(o.value)) && (
                                <Select
                                  value=""
                                  onChange={(e) => e.target.value && addSprintTo(m.key, e.target.value)}
                                  placeholder="+ Add sprint"
                                  aria-label={`Add a sprint to ${m.name}`}
                                  options={sprintOptions.filter((o) => !m.sprints.includes(o.value))}
                                  className="!h-8 !w-auto max-w-[260px] !text-[12px]"
                                />
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {!mayAssign && (
              <p className="text-[12px] text-faint">
                Putting people on tasks needs the Manage tasks permission, so these are added with nobody on them.
              </p>
            )}
            <section aria-label="Tasks to add" className="space-y-2">
              {(sprints.length > 0 || milestones.length > 0) && <p className="eyebrow">Tasks</p>}
              <ul className="space-y-3">
                {rows.map((r, i) => (
                  <li key={i} className={`rounded-xl border border-line p-3 ${r.keep ? '' : 'opacity-50'}`}>
                    <div className="flex items-start gap-3">
                      <KeepBox checked={r.keep} label={`Keep ${r.title}`} onToggle={() => patch(i, { keep: !r.keep })} />
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
                          <DateField label="Starts" value={r.start} aria={`Task ${i + 1} start date`} onChange={(v) => patch(i, { start: v })} />
                          <DateField label="Due" value={r.due} aria={`Task ${i + 1} due date`} onChange={(v) => patch(i, { due: v })} />
                          {scope.maySprint && sprintOptions.length > 0 && (
                            <Select
                              value={shown(r.sprintKey, sprintOptions)}
                              onChange={(e) => patch(i, { sprintKey: e.target.value })}
                              placeholder="Backlog"
                              aria-label={`Task ${i + 1} sprint`}
                              options={sprintOptions}
                              className="!h-10 !text-[13px]"
                            />
                          )}
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
                          {scope.mayTag && milestoneOptions.length > 0 && (
                            <Select
                              value={shown(milestoneOf(r), milestoneOptions)}
                              onChange={(e) => patch(i, { milestoneKey: e.target.value })}
                              placeholder="No milestone"
                              aria-label={`Task ${i + 1} milestone`}
                              options={milestoneOptions}
                              className="!h-10 !text-[13px]"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </Modal>
  )
}

function KeepBox({ checked, label, onToggle }: { checked: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className={`mt-2.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border ${
        checked ? 'border-navy-600 bg-navy-600 text-white dark:border-navy-400 dark:bg-navy-400' : 'border-[var(--line-strong)]'
      }`}
    >
      {checked && <Icon name="check" size={13} strokeWidth={3} />}
    </button>
  )
}

/** A date input with its word inside, so a row of them stays readable. */
function DateField({ label, value, aria, onChange }: { label: string; value: string; aria: string; onChange: (v: string) => void }) {
  return (
    <label className="relative block">
      <span className="pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2 font-mono text-[10px] tracking-wide text-faint uppercase">
        {label}
      </span>
      <Input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={aria}
        className="!h-10 !pl-16 !text-[13px]"
      />
    </label>
  )
}
