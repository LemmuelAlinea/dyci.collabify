import { useEffect, useState } from 'react'
import { Alert } from '../../../../components/ui/Alert'
import { Button } from '../../../../components/ui/Button'
import { Field } from '../../../../components/ui/Field'
import { Modal } from '../../../../components/ui/Modal'
import { Select } from '../../../../components/ui/Select'
import { useToast } from '../../../../components/ui/Toast'
import { listAccounts } from '../../../../lib/api/accounts'
import { assignSpacePm } from '../../../../lib/api/offboarding'
import { authErrorMessage } from '../../../../lib/authError'
import { isEligibleSuccessor } from '../../../../lib/offboarding'
import { fullName } from '../../../../lib/types'

type Space = { space_id: string; space_name: string }

/**
 * Names the project manager of a work space that has none. Only an active member
 * with Project manager on is offered; the database refuses anyone else and says
 * why, so its message is shown as it comes.
 */
export function SpacePmDialog({
  space,
  onClose,
  onDone,
}: {
  space: Space | null
  onClose: () => void
  onDone: () => void
}) {
  const { show } = useToast()
  const [people, setPeople] = useState<{ value: string; label: string }[] | null>(null)
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!space) return
    setPick('')
    setError(null)
    setLoadError(null)
    setPeople(null)
    let live = true
    listAccounts().then(
      (rows) => {
        if (live)
          setPeople(
            rows.filter((a) => isEligibleSuccessor(a, '')).map((a) => ({ value: a.id, label: fullName(a) })),
          )
      },
      (err) => {
        if (live) setLoadError(authErrorMessage(err, 'Could not load the people. Try again.'))
      },
    )
    return () => {
      live = false
    }
  }, [space, attempt])

  function close() {
    if (!busy) onClose()
  }

  async function save() {
    if (!space || !pick) return
    setBusy(true)
    setError(null)
    try {
      await assignSpacePm(space.space_id, pick)
      show(`Project manager assigned to ${space.space_name}`)
      onDone()
      onClose()
    } catch (err) {
      // A Supabase error is a plain object; its message is the database's own refusal.
      setError(authErrorMessage(err, 'Could not assign that project manager. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={space !== null}
      onClose={close}
      title={`Assign a project manager to ${space?.space_name ?? 'this space'}`}
      description="They become the space's project manager. Projects inside it keep their own managers."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button className="!rounded-xl" loading={busy} disabled={!pick} onClick={save}>
            Assign project manager
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {loadError && (
          <Alert tone="error" onRetry={() => setAttempt((n) => n + 1)}>
            {loadError}
          </Alert>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        {people !== null && people.length === 0 && (
          <Alert tone="info">
            Nobody can take over yet. Only an active member with Project manager on can. Turn on the
            Project manager switch for someone in Accounts first.
          </Alert>
        )}
        <Field label="Project manager" hint={<span className="text-[12px] text-faint">People with Project manager on</span>}>
          {(id) => (
            <Select
              id={id}
              data-space-pm
              value={pick}
              disabled={busy || !people || people.length === 0}
              placeholder="Choose a person"
              onChange={(e) => setPick(e.target.value)}
              options={people ?? []}
            />
          )}
        </Field>
      </div>
    </Modal>
  )
}
