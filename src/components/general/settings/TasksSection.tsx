// src/components/general/settings/TasksSection.tsx
import { useEffect, useState } from 'react'
import { Alert } from '../../ui/Alert'
import { Button } from '../../ui/Button'
import { useToast } from '../../ui/Toast'
import { updateGeneralProject } from '../../../lib/api/general'
import { authErrorMessage } from '../../../lib/authError'
import { checkStages, stagesOf, stagesToSave } from '../../../lib/stages'
import { StagesEditor } from '../../tasks/StagesEditor'
import { StagesView } from '../ProjectInfo'
import { RequestAccessButton } from '../RequestAccessButton'
import type { GeneralProjectState } from '../useGeneralProject'
import { EditButton } from './GeneralSection'

export function TasksSection({ state }: { state: GeneralProjectState }) {
  return (
    <div className="space-y-6">
      <StagesPanel state={state} />
    </div>
  )
}

function StagesPanel({ state }: { state: GeneralProjectState }) {
  const editable = state.can('edit_project') && !state.readOnly
  const [editing, setEditing] = useState(false)
  // Losing the permission mid-edit (an Owner takes it back) closes the form.
  const open = editable && editing

  return (
    <section className="card p-4 shadow-card sm:p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>Stages</h2>
          <p className="mt-0.5 text-[12px] text-muted">The columns this project's tasks move through.</p>
        </div>
        {!editable ? (
          <RequestAccessButton state={state} permission="edit_project" />
        ) : (
          !open && <EditButton label="Edit stages" onClick={() => setEditing(true)} />
        )}
      </header>
      {open ? <StagesForm state={state} onDone={() => setEditing(false)} /> : <StagesView state={state} />}
    </section>
  )
}

function StagesForm({ state, onDone }: { state: GeneralProjectState; onDone: () => void }) {
  const { show } = useToast()
  const p = state.project
  const [stages, setStages] = useState<string[]>([])
  const [qaStage, setQaStage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset when the project changes underneath, not on every realtime reload
  // while somebody is typing.
  const updatedAt = p?.updated_at
  useEffect(() => {
    if (!p) return
    setStages([...stagesOf(p.stages)])
    setQaStage(p.qa_stage ?? null)
  }, [updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!p) return null

  async function save() {
    if (!p) return
    setError(null)
    const stageProblem = checkStages(stages)
    if (stageProblem) return setError(`Progress stages: ${stageProblem}`)
    setBusy(true)
    try {
      await updateGeneralProject(p.id, {
        stages: stagesToSave(stages),
        qa_stage: qaStage?.trim() || null,
      })
      show('Project saved')
      await state.reload()
      onDone()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the project.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <StagesEditor
        value={stages}
        onChange={setStages}
        disabled={busy}
        qaStage={qaStage}
        onQaStageChange={setQaStage}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={busy}>
          Save stages
        </Button>
      </div>
    </div>
  )
}
