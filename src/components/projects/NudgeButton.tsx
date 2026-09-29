import { useState } from 'react'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Field } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { nudgeBoard } from '../../lib/api/results'
import { authErrorMessage } from '../../lib/authError'

/**
 * One click from "this board is quiet" to the people on it hearing about it.
 * The note is optional; without one they get a plain check-in. The database
 * keeps it to once a day per board and says so when asked twice.
 */
export function NudgeButton({ boardId, name }: { boardId: string; name: string }) {
  const { show } = useToast()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="relative z-10 shrink-0"
        aria-label={`Remind ${name}`}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen(true)
        }}
      >
        <Icon name="bell" size={14} />
        Remind
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        tone="primary"
        title={`Remind ${name}`}
        confirmLabel="Send reminder"
        onConfirm={async () => {
          try {
            const sent = await nudgeBoard(boardId, note)
            show(sent === 1 ? 'Reminder sent' : `Reminder sent to ${sent} people`)
            setNote('')
          } catch (err) {
            throw new Error(authErrorMessage(err, 'Could not send the reminder. Try again.'), { cause: err })
          }
        }}
        body={
          <div className="space-y-3">
            <p>
              Everyone on this board gets a notification. You can send one a day.
            </p>
            <Field label="Add a note" optional>
              {(id) => (
                <Textarea
                  id={id}
                  rows={3}
                  maxLength={280}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Show me a first draft by Friday."
                />
              )}
            </Field>
          </div>
        }
      />
    </>
  )
}
