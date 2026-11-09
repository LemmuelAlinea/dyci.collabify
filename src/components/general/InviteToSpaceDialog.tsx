import { useEffect, useState } from 'react'
import { Avatar } from '../app/Avatar'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { searchPeople } from '../../lib/api/general'
import { inviteToSpace } from '../../lib/api/spaces'
import { authErrorMessage } from '../../lib/authError'
import { ROLE_LABEL } from '../../lib/general/permissions'
import type { ProjectRole } from '../../lib/general/permissions'
import type { PersonHit } from '../../lib/general/types'

export function InviteToSpaceDialog({
  open,
  onClose,
  spaceId,
  onDone,
  search = searchPeople,
  invite = inviteToSpace,
  title = 'Invite to this space',
  description = 'They will be able to see every project in it.',
  noMatch = 'Nobody by that name.',
  roles,
}: {
  open: boolean
  onClose: () => void
  spaceId: string
  onDone: () => Promise<void>
  search?: (query: string) => Promise<PersonHit[]>
  invite?: (spaceId: string, userId: string, role?: ProjectRole) => Promise<void>
  title?: string
  description?: string
  /** What an empty search says. */
  noMatch?: string
  /** The roles the inviter may give. When set, the dialog asks which one and passes it to `invite`. */
  roles?: ProjectRole[]
}) {
  const { show } = useToast()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PersonHit[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [role, setRole] = useState<ProjectRole>('member')

  // A new opening starts on Member, never on the role the last invite used.
  useEffect(() => {
    if (open) setRole('member')
  }, [open])

  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length < 3) return setHits([])
    // Debounced: a search on every keystroke is a request per keystroke.
    const t = setTimeout(() => {
      void search(q)
        .then(setHits)
        .catch(() => setHits([]))
    }, 250)
    return () => clearTimeout(t)
  }, [query, open, search])

  async function invitePerson(person: PersonHit) {
    setBusy(person.person_id)
    try {
      await (roles ? invite(spaceId, person.person_id, role) : invite(spaceId, person.person_id))
      show(`${person.first_name} was invited`)
      await onDone()
      onClose()
      setQuery('')
    } catch (err) {
      show(authErrorMessage(err, 'Could not invite them.'), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      focusField
      footer={
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="space-y-3">
        {roles && (
          <Field label="Role">
            {(id) => (
              <Select
                id={id}
                value={role}
                options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                onChange={(e) => setRole(e.target.value as ProjectRole)}
              />
            )}
          </Field>
        )}
        <Field label="Search by name">
          {(id) => (
            <Input
              id={id}
              autoComplete="off"
              placeholder="Start typing a name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
        </Field>
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {hits.map((h) => (
            <li key={h.person_id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
              <Avatar profile={h} size={30} />
              <span className="flex-1 truncate text-[14px]">
                {h.first_name} {h.last_name}
              </span>
              <Button size="sm" loading={busy === h.person_id} onClick={() => void invitePerson(h)}>
                Invite
              </Button>
            </li>
          ))}
          {query.trim().length >= 3 && hits.length === 0 && (
            <li className="px-1 py-2 text-[13px] text-muted">{noMatch}</li>
          )}
        </ul>
      </div>
    </Modal>
  )
}
