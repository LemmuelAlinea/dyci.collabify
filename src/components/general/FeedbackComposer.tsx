import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Select, Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { createFeedback } from '../../lib/api/feedback'
import { authErrorMessage } from '../../lib/authError'
import { FEEDBACK_KINDS, FEEDBACK_KIND_LABEL } from '../../lib/general/feedback'
import type { FeedbackKind } from '../../lib/general/feedback'
import { AttachPicker } from './FeedbackParts'

/** The form for a new post. Stakeholders, the project manager and coordinators see it. */
export function FeedbackComposer({
  projectId,
  onPosted,
  onCancel,
}: {
  projectId: string
  /** Called with the new post's id. */
  onPosted: (id: string) => void
  onCancel: () => void
}) {
  const { show } = useToast()
  const [kind, setKind] = useState<FeedbackKind>('input')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)

  const ready = title.trim().length > 0 && body.trim().length > 0

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    try {
      const id = await createFeedback(projectId, kind, title, body, files)
      show('Feedback posted')
      onPosted(id)
    } catch (err) {
      show(authErrorMessage(err, 'Could not post your feedback. Try again.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4 rounded-card border border-line surface p-4 sm:p-5">
      <h2>New feedback</h2>
      <div className="grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
        <Field label="Type">
          {(id) => (
            <Select
              id={id}
              value={kind}
              onChange={(e) => setKind(e.target.value as FeedbackKind)}
              options={FEEDBACK_KINDS.map((k) => ({ value: k, label: FEEDBACK_KIND_LABEL[k] }))}
            />
          )}
        </Field>
        <Field label="Title">
          {(id) => (
            <Input id={id} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          )}
        </Field>
      </div>
      <Field label="Details">
        {(id) => (
          <Textarea id={id} rows={5} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
        )}
      </Field>
      <Field label="Attachments" optional>
        {() => <AttachPicker files={files} onChange={setFiles} disabled={busy} />}
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" loading={busy} disabled={!ready}>
          Post feedback
        </Button>
      </div>
    </form>
  )
}
