import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../ui/Button'
import { Alert } from '../ui/Alert'
import { Icon, Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { ProjectForm } from './ProjectForm'
import type { ProjectFormValue } from './ProjectForm'
import { SeriesScope } from './SeriesScope'
import { listLiveSets } from '../../lib/api/groups'
import type { LiveGroupSet } from '../../lib/api/groups'
import { listProfessorClasses } from '../../lib/api/classes'
import {
  createProjectSeries,
  listSeriesMembers,
  updateProjectSeries,
  uploadProjectFile,
} from '../../lib/api/projects'
import type { CriterionInput } from '../../lib/api/projects'
import { classWeekMap } from '../../lib/api/syllabus'
import { authErrorMessage } from '../../lib/authError'
import type { ClassSummary, ClassWeek, ProjectSummary, SeriesMember } from '../../lib/types'

const FORM_ID = 'project-form'

export function ProjectWizard({
  open,
  onClose,
  classes,
  fixedClassId,
  createdBy,
  editing,
  editingCriteria,
  onSaved,
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

  useEffect(() => {
    if (open) setClassId(fixedClassId ?? editing?.class_id ?? '')
  }, [open, fixedClassId, editing])

  useEffect(() => {
    if (!open || editing) return
    let live = true
    void listProfessorClasses(createdBy)
      .then((cs) => live && setMine(cs))
      .catch(() => live && setMine([]))
    return () => {
      live = false
    }
  }, [open, editing, createdBy])

  // The sections an edit could reach. Empty for a project that is not in a
  // series, which is what keeps the scope picker off an ordinary project.
  useEffect(() => {
    if (!open || !editing) {
      setMembers([])
      setScope([])
      return
    }
    let live = true
    setScope([])
    void listSeriesMembers(editing.series_id)
      .then((m) => live && setMembers(m))
      .catch(() => live && setMembers([]))
    return () => {
      live = false
    }
  }, [open, editing])

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
    // Sets are loaded for every class the professor teaches, not just this one:
    // each section of a fan-out names its own arrangement.
    const ids = editing ? [classId] : [...new Set([classId, ...mine.map((c) => c.id)])]
    void Promise.all([classWeekMap(classId), listLiveSets(ids)])
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
  }, [open, classId, editing, mine])

  const cls = classes.find((c) => c.id === classId) ?? mine.find((c) => c.id === classId)

  async function save(value: ProjectFormValue) {
    setError(null)
    setBusy(true)
    try {
      if (editing) {
        // The section being edited is always in scope; the picker only ever
        // adds siblings to it.
        const targets = [editing.id, ...scope.filter((id) => id !== editing.id)]
        await updateProjectSeries(targets, value.input, value.criteria)
        if (value.file) await uploadProjectFile(editing.id, value.file)
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
      onClose={onClose}
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
          <Button variant="ghost" onClick={onClose} disabled={busy}>
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
              onChange={(e) => setClassId(e.target.value)}
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
              to="/professor/classes"
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
              to={`/professor/syllabi/${cls.syllabus_id}`}
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
          />
        )}
      </div>
    </Modal>
  )
}
