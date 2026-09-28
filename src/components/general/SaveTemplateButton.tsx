import { useMemo, useState } from 'react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Alert } from '../ui/Alert'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { saveTemplate } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { payloadSummary, templatePayload } from '../../lib/general/templates'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * Save this project's structure as the person's own starting point. It shows
 * up under "Your templates" the next time they start a project.
 */
export function SaveTemplateButton({ state, className }: { state: GeneralProjectState; className: string }) {
  const { show } = useToast()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [blurb, setBlurb] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const payload = useMemo(
    () =>
      templatePayload({
        fields: state.fields,
        teams: state.teams,
        positions: state.positions,
        tasks: state.tasks,
      }),
    [state.fields, state.teams, state.positions, state.tasks],
  )

  function start() {
    setName(state.project?.name ?? '')
    setBlurb(state.project?.description.slice(0, 300) ?? '')
    setError(null)
    setOpen(true)
  }

  async function save() {
    if (!name.trim()) return setError('Give the template a name.')
    setBusy(true)
    setError(null)
    try {
      await saveTemplate({ name, blurb, sourcePreset: state.project?.preset ?? null, payload })
      show('Saved to your templates')
      setOpen(false)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the template.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" onClick={start} className={className}>
        <Icon name="copy" size={15} />
        Save as template
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Save as template"
        description="Start your next project with this one's fields, teams, positions and tasks. Dates, people and files stay here."
        size="sm"
        focusField
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} loading={busy} className="!rounded-xl">
              Save template
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Name">
            {(id) => <Input id={id} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="What it is for" optional>
            {(id) => (
              <Textarea id={id} rows={2} maxLength={300} value={blurb} onChange={(e) => setBlurb(e.target.value)} />
            )}
          </Field>
          <p className="font-mono text-[12px] text-faint">{payloadSummary(payload)}</p>
        </div>
      </Modal>
    </>
  )
}
