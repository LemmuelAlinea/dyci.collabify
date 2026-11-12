import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../ui/Button'
import { Alert } from '../ui/Alert'
import { Icon, Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { CreateSetWizard } from '../groups/CreateSetWizard'
import { ProjectForm } from './ProjectForm'
import type { MadeSet, ProjectFormValue } from './ProjectForm'
import { SeriesScope } from './SeriesScope'
import { deleteSet, listLiveSets, projectsUsingSet } from '../../lib/api/groups'
import type { LiveGroupSet } from '../../lib/api/groups'
import { listProfessorClasses } from '../../lib/api/classes'
import {
  createProjectSeries,
  listSeriesMembers,
  setProjectAudience,
  updateProjectSeries,
  uploadProjectFile,
} from '../../lib/api/projects'
import type { CriterionInput } from '../../lib/api/projects'
import { classWeekMap } from '../../lib/api/syllabus'
import { authErrorMessage } from '../../lib/authError'
import { paths } from '../../lib/paths'
import type {
  ClassSummary,
  ClassWeek,
  GroupSet,
  ProjectSummary,
  SeriesMember,
} from '../../lib/types'

const FORM_ID = 'project-form'

/**
 * Removes the sets made inside a wizard that closed without saving, leaving any
 * that a project already uses. Returns how many went.
 */
async function removeUnusedSets(ids: string[]) {
  let removed = 0
  for (const id of ids) {
    try {
      if ((await projectsUsingSet(id)) === 0) {
        await deleteSet(id)
        removed++
      }
    } catch {
      // Left in place, it is an ordinary set the class Groups tab can delete.
    }
  }
  return removed
}

export function ProjectWizard({
  open,
  onClose,
  classes,
  fixedClassId,
  createdBy,
  editing,
  editingCriteria,
  onSaved,
  rubricLocked = false,
  onClearScores,
}: {
  open: boolean
  onClose: () => void
  classes: ClassSummary[]
  fixedClassId?: string
  createdBy: string
  /** Set to edit an existing project rather than create one. */
  editing?: ProjectSummary
  editingCriteria?: CriterionInput[]
  onSaved: (projectId: string) => Promise<void> | void
  /** Scores exist: the total and the rubric's points are fixed. */
  rubricLocked?: boolean
  onClearScores?: () => Promise<void>
}) {
  const [classId, setClassId] = useState(fixedClassId ?? editing?.class_id ?? '')
  const [weeks, setWeeks] = useState<ClassWeek[] | null>(null)
  const [sets, setSets] = useState<LiveGroupSet[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Every class this professor teaches, so a project can be given to the other
  // sections of the same course. The `classes` prop cannot serve: the class
  // page passes only the one class it is showing.
  const [mine, setMine] = useState<ClassSummary[]>([])
  const [members, setMembers] = useState<SeriesMember[]>([])
  const [scope, setScope] = useState<string[]>([])

  const { show } = useToast()
  // Groups made from inside the wizard, for the class or one of its sections.
  // The ids are what a close without saving removes again. Nothing on screen
  // reads them, so a ref: a close then sees the list as it is now.
  const [makeFor, setMakeFor] = useState<string | null>(null)
  const [makeOpen, setMakeOpen] = useState(false)
  const [madeSet, setMadeSet] = useState<MadeSet | null>(null)
  const madeSetIds = useRef<string[]>([])
  const showRef = useRef(show)
  useEffect(() => {
    showRef.current = show
  })

  /**
   * Takes back the groups made here, unless a project uses them. Every way out
   * that is not a save ends here: Cancel, Escape, the page closing the dialog
   * itself, and the page going away with the dialog still open.
   */
  function takeBackMade() {
    const made = madeSetIds.current
    madeSetIds.current = []
    if (made.length === 0) return
    void removeUnusedSets(made).then((removed) => {
      if (removed > 0) showRef.current('Groups made for this project were removed.')
    })
  }
  // It reads only refs, so the first render's copy is as good as any later one.
  const takeBackRef = useRef(takeBackMade)

  // Either edge: a page that closes the dialog without Cancel still gets its
  // leftovers removed, and a fresh open never inherits an earlier session's.
  useEffect(() => {
    takeBackRef.current()
    if (open) setMadeSet(null)
  }, [open])

  // Leaving the page with the dialog open: Back, or a link inside it.
  useEffect(() => () => takeBackRef.current(), [])

  // The effects below read the project being edited by its values, never by the
  // object. The project page refetches on every live change and on a 30-second
  // poll, handing over a new object each time; keyed on that, each refetch
  // blanked the weeks, which unmounted the form and threw away the edit.
  const isEditing = Boolean(editing)
  const editingClassId = editing?.class_id
  const editingSeriesId = editing?.series_id

  useEffect(() => {
    if (open) setClassId(fixedClassId ?? editingClassId ?? '')
  }, [open, fixedClassId, editingClassId])

  useEffect(() => {
    if (!open || isEditing) return
    let live = true
    void listProfessorClasses(createdBy)
      .then((cs) => live && setMine(cs))
      .catch(() => live && setMine([]))
    return () => {
      live = false
    }
  }, [open, isEditing, createdBy])

  // The sections an edit could reach. Empty for a project that is not in a
  // series, which is what keeps the scope picker off an ordinary project.
  useEffect(() => {
    if (!open || !isEditing) {
      setMembers([])
      setScope([])
      return
    }
    let live = true
    setScope([])
    void listSeriesMembers(editingSeriesId ?? null)
      .then((m) => live && setMembers(m))
      .catch(() => live && setMembers([]))
    return () => {
      live = false
    }
  }, [open, isEditing, editingSeriesId])

  // Sets are loaded for every class the professor teaches, not just this one:
  // each section of a fan-out names its own arrangement.
  const setClassIds = useMemo(
    () => (isEditing ? [classId] : [...new Set([classId, ...mine.map((c) => c.id)])]),
    [isEditing, classId, mine],
  )

  useEffect(() => {
    if (!open || !classId) {
      setWeeks(null)
      setSets([])
      return
    }
    let live = true
    setWeeks(null)
    // Otherwise the previous class's groups stay on screen while this one loads.
    setSets([])
    void Promise.all([classWeekMap(classId), listLiveSets(setClassIds)])
      .then(([w, s]) => {
        if (!live) return
        setWeeks(w)
        setSets(s)
      })
      .catch((err) => {
        if (!live) return
        setError(authErrorMessage(err, 'Could not load that class.'))
        setWeeks([])
      })
    return () => {
      live = false
    }
  }, [open, classId, setClassIds])

  const cls = classes.find((c) => c.id === classId) ?? mine.find((c) => c.id === classId)

  function makeGroups(forClassId: string) {
    setMakeFor(forClassId)
    setMakeOpen(true)
  }

  /**
   * Picks up the set just made without reloading the weeks: blanking those
   * unmounts the form, and everything typed into it with them.
   */
  async function groupsMade(set: GroupSet) {
    madeSetIds.current = [...madeSetIds.current, set.id]
    try {
      setSets(await listLiveSets(setClassIds))
    } catch (err) {
      setError(authErrorMessage(err, 'The groups were made, but the list here did not refresh. They stay selected; save to keep them.'))
    }
    setMadeSet({ id: set.id, classId: set.class_id, primary: set.class_id === classId })
  }

  /** Closing without saving takes back the groups made here, unless a project uses them. */
  function cancel() {
    if (busy) return
    takeBackMade()
    onClose()
  }

  async function save(value: ProjectFormValue) {
    setError(null)
    setBusy(true)
    try {
      if (editing) {
        // The section being edited is always in scope; the picker only ever
        // adds siblings to it.
        const targets = [editing.id, ...scope.filter((id) => id !== editing.id)]
        // Who does it belongs to this section alone, and the series update
        // leaves it out. First, so a refusal (work already started) stops the
        // save before anything else is written.
        const nextSet = value.input.audience === 'group' ? value.input.groupSetId : null
        if (value.input.audience !== editing.audience || nextSet !== editing.group_set_id) {
          await setProjectAudience(editing.id, value.input.audience, nextSet)
        }
        await updateProjectSeries(targets, value.input, value.criteria)
        if (value.file) await uploadProjectFile(editing.id, value.file)
        // Saved, the groups made here are the class's to keep. Cleared before
        // onSaved, which may navigate away and unmount this dialog.
        madeSetIds.current = []
        await onSaved(editing.id)
      } else {
        // One function serves both cases: a single section is written as an
        // ordinary project with no series.
        const ids = await createProjectSeries(
          [{ classId, groupSetId: value.input.groupSetId }, ...value.sections],
          value.input,
          value.criteria,
        )
        // The storage policy reads the project id off the path, so a shared
        // brief has to be attached to each section's own project.
        if (value.file) {
          for (const id of ids) await uploadProjectFile(id, value.file)
        }
        madeSetIds.current = []
        await onSaved(ids[0])
      }
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the project.'))
    } finally {
      setBusy(false)
    }
  }

  const ready = Boolean(cls?.syllabus_id) && (weeks?.length ?? 0) > 0
  const inSeries = Boolean(editing) && members.length > 1

  return (
    <Modal
      open={open}
      onClose={cancel}
      title={editing ? 'Edit project' : 'New project'}
      description={
        editing
          ? inSeries
            ? 'Choose which sections this edit reaches. The rest are left as they are.'
            : 'Everything here stays editable, including the weeks it is based on.'
          : 'A project is built on the weeks of the class syllabus.'
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={cancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            form={FORM_ID}
            type="submit"
            loading={busy}
            disabled={!ready}
            className="!rounded-xl"
          >
            {editing ? 'Save changes' : 'Create project'}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {error && <Alert tone="error">{error}</Alert>}

        {!fixedClassId && !editing && (
          <label className="block space-y-2">
            <span className="text-[13px] font-medium text-ink">Class</span>
            <Select
              value={classId}
              onChange={(e) => {
                // The form remounts for the new class; a set made for the old
                // one must not be selected in it.
                setMadeSet(null)
                setClassId(e.target.value)
              }}
              placeholder="Pick a class"
              options={classes.map((c) => ({ value: c.id, label: `${c.initial} · ${c.name}` }))}
            />
          </label>
        )}

        {editing && inSeries && (
          <SeriesScope
            members={members}
            current={editing.id}
            chosen={scope}
            onChange={setScope}
          />
        )}

        {!classId ? (
          <p className="text-[13px] text-muted">
            Pick the class first — its syllabus decides what a project can be based on.
          </p>
        ) : weeks === null ? (
          <div className="flex items-center gap-3 py-8 text-[14px] text-muted">
            <Spinner size={16} />
            Reading the syllabus…
          </div>
        ) : !cls?.syllabus_id ? (
          <Alert tone="info">
            <p>
              {cls?.name ?? 'This class'} has no syllabus attached, so there is nothing to base
              a project on.
            </p>
            <Link
              to={paths.classes}
              className="mt-2 inline-flex items-center gap-2 font-medium hover:underline"
            >
              <Icon name="edit" size={14} />
              Attach one in the class settings
            </Link>
          </Alert>
        ) : weeks.length === 0 ? (
          <Alert tone="info">
            <p>The syllabus on this class has no weeks yet.</p>
            <Link
              to={paths.syllabus(cls.syllabus_id)}
              className="mt-2 inline-flex items-center gap-2 font-medium hover:underline"
            >
              <Icon name="calendar" size={14} />
              Open the syllabus and add its weeks
            </Link>
          </Alert>
        ) : (
          <ProjectForm
            // Remounts when the class changes so week defaults are recalculated.
            key={`${classId}-${editing?.id ?? 'new'}`}
            formId={FORM_ID}
            weeks={weeks}
            groupSets={sets.filter((s) => s.class_id === classId)}
            defaults={editing}
            defaultCriteria={editingCriteria}
            sectionOptions={
              editing || mine.length < 2
                ? undefined
                : { primary: cls, classes: mine, groupSets: sets }
            }
            onSubmit={save}
            rubricLocked={rubricLocked}
            onClearScores={onClearScores}
            onMakeGroups={makeGroups}
            madeSet={madeSet}
          />
        )}
      </div>

      <CreateSetWizard
        open={makeOpen}
        onClose={() => setMakeOpen(false)}
        classes={mine.length > 0 ? mine : classes}
        // Kept after closing, so the dialog does not flash a class picker on its way out.
        fixedClassId={makeFor ?? undefined}
        onCreated={groupsMade}
      />
    </Modal>
  )
}
