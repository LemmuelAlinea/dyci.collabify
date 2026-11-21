import { useEffect, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Input, Toggle } from '../ui/Field'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { StagesEditor } from '../tasks/StagesEditor'
import { getClassTaskSettings, listProjectsForClasses, updateClassTaskSettings } from '../../lib/api/projects'
import type { ClassTaskSettings as Settings } from '../../lib/api/projects'
import { authErrorMessage } from '../../lib/authError'
import { PRIORITIES } from '../../lib/general/types'
import { checkStages, stagesOf, stagesToSave } from '../../lib/stages'
import type { ProjectSummary } from '../../lib/types'

export function ClassTaskSettings({ classId, readOnly = false }: { classId: string; readOnly?: boolean }) {
  const { show } = useToast()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectId, setProjectId] = useState('')
  const [saved, setSaved] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    listProjectsForClasses([classId]).then((rows) => {
      if (!live) return
      setProjects(rows)
      setProjectId((current) => current || rows[0]?.id || '')
    }).catch((err) => live && setError(authErrorMessage(err, 'Could not load projects.')))
    return () => { live = false }
  }, [classId])

  useEffect(() => {
    if (!projectId) return
    let live = true
    setSaved(null)
    setDraft(null)
    setError(null)
    getClassTaskSettings(projectId).then((settings) => {
      if (!live) return
      setSaved(settings)
      setDraft(settings)
    }).catch((err) => live && setError(authErrorMessage(err, 'Could not load task settings.')))
    return () => { live = false }
  }, [projectId])

  if (!draft) return <div className="space-y-4">
    <ProjectPicker projects={projects} projectId={projectId} onChange={setProjectId} />
    {error ? <Alert tone="error">{error}</Alert> : <p className="text-[13px] text-muted">{projects.length ? 'Loading task settings…' : 'No projects yet.'}</p>}
  </div>

  const stages = stagesOf(draft.stages)
  const startLimit = stages.length - 2
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((current) => current && ({ ...current, [key]: value }))
  const names = draft.task_types
  const switches: { key: keyof Settings; label: string }[] = [
    { key: 'allow_subtasks', label: 'Allow subtasks' },
    { key: 'allow_dependencies', label: 'Allow dependencies' },
    { key: 'allow_multiple_assignees', label: 'Allow multiple holders' },
    { key: 'require_assignee', label: 'Require a holder before work starts' },
    { key: 'require_subtasks_done', label: 'Require all subtasks to be done first' },
  ]

  async function save() {
    if (!draft) return
    const problem = checkStages(stages)
    if (problem) return setError(`Task workflow steps: ${problem}`)
    const cleaned = names.map((name) => name.trim())
    if (cleaned.some((name) => !name || name.length > 40 || name.toLowerCase() === 'task')
      || new Set(cleaned.map((name) => name.toLowerCase())).size !== cleaned.length) {
      return setError('Use distinct task type names of 1 to 40 characters, apart from Task.')
    }
    const next = {
      ...draft, stages: stagesToSave(stages), task_types: cleaned,
      default_stage: draft.require_assignee ? 0 : Math.min(draft.default_stage, startLimit),
    }
    setBusy(true)
    setError(null)
    try {
      await updateClassTaskSettings(projectId, next)
      setSaved(next)
      setDraft(next)
      show('Task settings saved')
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save task settings.'))
    } finally { setBusy(false) }
  }

  return <div className="space-y-6">
    <ProjectPicker projects={projects} projectId={projectId} onChange={setProjectId} />
    {error && <Alert tone="error">{error}</Alert>}
    <section className="card space-y-4 p-4 shadow-card sm:p-5">
      <header><h2>Task workflow steps</h2><p className="text-[12px] text-muted">The columns this project's tasks move through.</p></header>
      <StagesEditor value={stages} onChange={(value) => set('stages', stagesToSave(value))} disabled={busy || readOnly} />
    </section>
    <section className="card space-y-4 p-4 shadow-card sm:p-5">
      <header><h2>Task types</h2><p className="text-[12px] text-muted">Add choices alongside Task. Existing tasks keep a type you remove.</p></header>
      <p className="text-[13px] text-muted">Built in: Task</p>
      {names.map((name, index) => <div key={index} className="flex max-w-md gap-2">
        <Input aria-label={`Custom task type ${index + 1}`} value={name} maxLength={40} disabled={busy || readOnly}
          onChange={(e) => set('task_types', names.map((value, i) => i === index ? e.target.value : value))} />
        <Button variant="ghost" disabled={busy || readOnly} onClick={() => set('task_types', names.filter((_, i) => i !== index))}>Remove</Button>
      </div>)}
      <Button variant="outline" disabled={busy || readOnly || names.length >= 20} onClick={() => set('task_types', [...names, ''])}>Add type</Button>
    </section>
    <section className="card space-y-4 p-4 shadow-card sm:p-5">
      <header><h2>Task rules</h2><p className="text-[12px] text-muted">Defaults and limits for this project's tasks.</p></header>
      <label className="block space-y-1"><span className="text-[13px]">Default priority</span>
        <Select value={draft.default_priority} disabled={busy || readOnly} onChange={(e) => set('default_priority', e.target.value as Settings['default_priority'])}
          options={PRIORITIES.map((priority) => ({ value: priority.value, label: priority.label }))} />
      </label>
      <label className="block space-y-1"><span className="text-[13px]">New tasks start in</span>
        <Select value={String(draft.require_assignee ? 0 : Math.min(draft.default_stage, startLimit))} disabled={busy || readOnly || draft.require_assignee}
          onChange={(e) => set('default_stage', Number(e.target.value))}
          options={stages.slice(0, startLimit + 1).map((stage, index) => ({ value: String(index), label: stage }))} />
      </label>
      {switches.map(({ key, label }) => <Toggle key={key} label={label} checked={Boolean(draft[key])} disabled={busy || readOnly}
        onChange={(checked) => setDraft((current) => current && ({ ...current, [key]: checked }))} />)}
    </section>
    {!readOnly && <div className="flex justify-end"><Button onClick={() => void save()} loading={busy}
      disabled={JSON.stringify(saved) === JSON.stringify(draft)}>Save task settings</Button></div>
    }
  </div>
}

function ProjectPicker({ projects, projectId, onChange }: {
  projects: ProjectSummary[]; projectId: string; onChange: (id: string) => void
}) {
  return <label className="block max-w-md space-y-1"><span className="text-[13px] font-medium text-ink">Project</span>
    <Select value={projectId} onChange={(e) => onChange(e.target.value)}
      options={projects.map((project) => ({ value: project.id, label: project.title }))} />
  </label>
}
