import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../ui/Button'
import { Alert } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { ProjectForm } from './ProjectForm'
import type { ProjectFormValue } from './ProjectForm'
import { listLiveSets } from '../../lib/api/groups'
import type { LiveGroupSet } from '../../lib/api/groups'
import {
  createProject,
  replaceCriteria,
  updateProject,
  uploadProjectFile,
} from '../../lib/api/projects'
import type { CriterionInput } from '../../lib/api/projects'
import { classWeekMap } from '../../lib/api/syllabus'
import { authErrorMessage } from '../../lib/authError'
import type { ClassSummary, ClassWeek, ProjectSummary } from '../../lib/types'

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

  useEffect(() => {
    if (open) setClassId(fixedClassId ?? editing?.class_id ?? '')
  }, [open, fixedClassId, editing])

  useEffect(() => {
    if (!open || !classId) {
      setWeeks(null)
      return
    }
    let live = true
    setWeeks(null)
    void Promise.all([classWeekMap(classId), listLiveSets([classId])])
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
  }, [open, classId])

  const cls = classes.find((c) => c.id === classId)

  async function save(value: ProjectFormValue) {
    setError(null)
    setBusy(true)
    try {
      const input = { ...value.input, classId }
      const id = editing
        ? (await updateProject(editing.id, input), editing.id)
        : await createProject(input, createdBy)
      await replaceCriteria(id, value.criteria)
      if (value.file) await uploadProjectFile(id, value.file)
      await onSaved(id)
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the project.'))
    } finally {
      setBusy(false)
    }
  }

  const ready = Boolean(cls?.syllabus_id) && (weeks?.length ?? 0) > 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit project' : 'New project'}
      description={
        editing
          ? 'Everything here stays editable, including the weeks it is based on.'
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
          <label className="block space-y-1.5">
            <span className="text-[13.5px] font-medium text-ink">Class</span>
            <Select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              placeholder="Pick a class"
              options={classes.map((c) => ({ value: c.id, label: `${c.initial} · ${c.name}` }))}
            />
          </label>
        )}

        {!classId ? (
          <p className="text-[13.5px] text-muted">
            Pick the class first — its syllabus decides what a project can be based on.
          </p>
        ) : weeks === null ? (
          <div className="flex items-center gap-2.5 py-8 text-[14px] text-muted">
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
              className="mt-2 inline-flex items-center gap-1.5 font-medium hover:underline"
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
              className="mt-2 inline-flex items-center gap-1.5 font-medium hover:underline"
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
            groupSets={sets}
            defaults={editing}
            defaultCriteria={editingCriteria}
            onSubmit={save}
          />
        )}
      </div>
    </Modal>
  )
}
