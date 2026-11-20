import { useState } from 'react'
import { saveBoardStageTerms } from '../../lib/api/stageTerms'
import { authErrorMessage } from '../../lib/authError'
import { validStageTerms } from '../../lib/work/stageTerms'
import type { BoardSummary } from '../../lib/types'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Input } from '../ui/Field'

export function BoardStageNames({ board, canEdit, onSaved }: {
  board: BoardSummary
  canEdit: boolean
  onSaved: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [singular, setSingular] = useState(board.term_singular ?? 'Stage')
  const [plural, setPlural] = useState(board.term_plural ?? 'Stages')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const terms = { singular: singular.trim(), plural: plural.trim() }
    if (!validStageTerms(terms)) return setError('Use singular and plural names of 1 to 24 characters.')
    setBusy(true)
    setError(null)
    try {
      await saveBoardStageTerms(board.id, terms)
      await onSaved()
      setEditing(false)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the board label.'))
    } finally {
      setBusy(false)
    }
  }

  return <div className="card flex flex-wrap items-center gap-3 p-4 text-[13px]">
    <span className="font-medium text-ink">Work cycles: {board.term_plural ?? 'Stages'}</span>
    {canEdit && !editing && <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Change name</Button>}
    {editing && <div className="flex w-full flex-wrap items-end gap-3">
      <label className="space-y-1">Singular<Input value={singular} maxLength={24} onChange={(e) => setSingular(e.target.value)} /></label>
      <label className="space-y-1">Plural<Input value={plural} maxLength={24} onChange={(e) => setPlural(e.target.value)} /></label>
      <Button size="sm" loading={busy} onClick={() => void save()}>Save</Button>
      <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
      <p className="w-full text-muted">Saved cycle names will stay as they are.</p>
    </div>}
    {error && <Alert tone="error">{error}</Alert>}
  </div>
}
