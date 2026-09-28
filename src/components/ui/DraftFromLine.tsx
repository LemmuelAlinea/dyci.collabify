import { useState } from 'react'
import { Button } from './Button'
import { Input } from './Field'
import { Icon } from './Icon'
import { draftNotice } from '../../lib/api/announcements'
import { authErrorMessage } from '../../lib/authError'

/**
 * One line in, a title and message out, into the composer's own fields. The
 * sender reads and edits it there; nothing is posted from here.
 */
export function DraftFromLine({
  classId,
  onDraft,
}: {
  /** Omitted for a program-wide notice. */
  classId?: string
  onDraft: (draft: { title: string; body: string }) => void
}) {
  const [intent, setIntent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function run() {
    if (intent.trim().length < 4) return setError('Say in a few words what it is about.')
    setBusy(true)
    setError(null)
    try {
      const res = await draftNotice({ intent, classId })
      if (res.result !== 'ok' || !res.title || !res.body) {
        setError(res.message ?? 'No draft could be written. Write it by hand.')
        return
      }
      onDraft({ title: res.title, body: res.body })
      setDone(true)
    } catch (err) {
      setError(authErrorMessage(err, 'The draft could not be written. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-dashed border-line p-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <Input
            value={intent}
            onChange={(e) => {
              setIntent(e.target.value)
              setDone(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void run()
              }
            }}
            maxLength={500}
            aria-label="What the announcement is about"
            placeholder="In a line: quiz moved to Friday, bring laptops"
            className="!h-10 !text-[13px]"
          />
        </div>
        <Button type="button" size="sm" variant="outline" loading={busy} onClick={() => void run()}>
          {!busy && <Icon name="spark" size={14} />}
          Draft with AI
        </Button>
      </div>
      {error ? (
        <p className="text-[12px] text-danger-700 dark:text-danger-300">{error}</p>
      ) : (
        <p className="text-[12px] text-faint">
          {done
            ? 'Drafted below. Check every date and detail before you send it.'
            : 'Fills the title and message below. Nothing is sent until you send it.'}
        </p>
      )}
    </div>
  )
}
