import { useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { Field, Input, Toggle } from '../ui/Field'
import { Alert } from '../ui/Alert'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { POLL_MESSAGE, createPoll } from '../../lib/api/polls'
import { authErrorMessage } from '../../lib/authError'

const MIN_OPTIONS = 2

export function CreatePollDialog({
  open,
  onClose,
  conversationId,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  conversationId: string
  onCreated: () => Promise<void> | void
}) {
  const { show } = useToast()
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [allowMultiple, setAllowMultiple] = useState(false)
  const [allowNewOptions, setAllowNewOptions] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setQuestion('')
    setOptions(['', ''])
    setAllowMultiple(false)
    setAllowNewOptions(false)
    setError(null)
  }, [open])

  const filled = options.map((o) => o.trim()).filter(Boolean)
  const ready = question.trim().length > 0 && filled.length >= MIN_OPTIONS

  async function submit() {
    setError(null)
    if (!ready) {
      setError(`Add a question and at least ${MIN_OPTIONS} options.`)
      return
    }
    setBusy(true)
    try {
      const { result } = await createPoll({
        conversationId,
        question,
        options: filled,
        allowMultiple,
        allowNewOptions,
      })
      if (result !== 'ok') {
        setError(POLL_MESSAGE[result] ?? 'Could not create that poll.')
        return
      }
      show('Poll posted')
      onClose()
      await onCreated()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not create that poll.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a poll"
      description="It posts into this chat, and everyone can vote."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!ready} className="!rounded-xl">
            Post poll
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        <Field label="Question">
          {(id) => (
            <Input
              id={id}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Which defense slot works for everyone?"
              maxLength={160}
            />
          )}
        </Field>

        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-ink">Options</legend>
          <div className="space-y-2">
            {options.map((value, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={value}
                  onChange={(e) =>
                    setOptions((list) => list.map((v, n) => (n === i ? e.target.value : v)))
                  }
                  placeholder={`Option ${i + 1}`}
                  aria-label={`Option ${i + 1}`}
                />
                {options.length > MIN_OPTIONS && (
                  <button
                    type="button"
                    onClick={() => setOptions((list) => list.filter((_, n) => n !== i))}
                    aria-label={`Remove option ${i + 1}`}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-faint hover:bg-[var(--surface-sunken)] hover:text-ink"
                  >
                    <Icon name="x" size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setOptions((list) => [...list, ''])}
            className="mt-2.5 flex items-center gap-1.5 text-[13px] font-medium text-navy-600 hover:underline dark:text-navy-200"
          >
            <Icon name="plus" size={15} />
            Add option
          </button>
        </fieldset>

        <div className="space-y-3 border-t border-line pt-4">
          <label className="flex items-start justify-between gap-4">
            <span className="min-w-0">
              <span className="block text-[14px] font-medium text-ink">Allow multiple answers</span>
              <span className="block text-[12px] text-muted">
                People can pick more than one option.
              </span>
            </span>
            <Toggle
              label="Allow multiple answers"
              checked={allowMultiple}
              onChange={setAllowMultiple}
            />
          </label>

          <label className="flex items-start justify-between gap-4">
            <span className="min-w-0">
              <span className="block text-[14px] font-medium text-ink">Let others add options</span>
              <span className="block text-[12px] text-muted">
                Anyone in the chat can extend the list. You always can.
              </span>
            </span>
            <Toggle
              label="Let others add options"
              checked={allowNewOptions}
              onChange={setAllowNewOptions}
            />
          </label>
        </div>
      </div>
    </Modal>
  )
}
