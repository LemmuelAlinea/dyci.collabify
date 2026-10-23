import { useEffect, useState } from 'react'
import { Avatar } from '../app/Avatar'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { assignProjectPm, searchProjectManagers } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import type { PersonHit } from '../../lib/general/types'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * A work project whose project manager was deactivated, or lost the Project
 * manager switch, keeps working; only the PM-only actions wait. Its
 * Coordinators and its space's Owners are told, and an Owner can assign a new
 * project manager (assign_general_project_pm checks the same again).
 */
export function NoPmNotice({ state }: { state: GeneralProjectState }) {
  const { spaces } = useGeneralNavigation()
  const [picking, setPicking] = useState(false)
  const p = state.project
  if (!p || p.has_pm || p.class_board_id) return null

  const spaceOwner = Boolean(spaces?.some((s) => s.id === p.space_id && s.my_level === 'owner'))
  if (state.myRole !== 'coordinator' && !spaceOwner) return null

  return (
    <div
      role="status"
      className="flex flex-wrap items-start gap-3 rounded-xl border border-warning-300 bg-warning-400/6 px-3.5 py-3 text-[13px] leading-relaxed text-ink xl:col-span-2 dark:border-warning-400/40 dark:bg-warning-400/8"
    >
      <Icon name="alert" size={17} className="mt-px shrink-0 text-warning-600 dark:text-warning-300" />
      <p className="min-w-[14rem] flex-1">
        This project has no project manager. Work goes on, but only a project manager can change its
        details, archive it or hand it over.
      </p>
      {spaceOwner && (
        <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
          Assign a project manager
        </Button>
      )}
      <AssignPmDialog
        open={picking}
        onClose={() => setPicking(false)}
        projectId={p.id}
        projectName={p.name}
        onDone={state.reload}
      />
    </div>
  )
}

/**
 * Finds people with Project manager turned on and makes one the project's
 * manager. Used by a space Owner from the project and by an admin from Work
 * projects; the search only answers them.
 */
export function AssignPmDialog({
  open,
  onClose,
  projectId,
  projectName,
  onDone,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  projectName: string
  onDone: () => void | Promise<void>
}) {
  const { show } = useToast()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PersonHit[]>([])
  const [searching, setSearching] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setHits([])
      setFailed(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length < 3) {
      setHits([])
      return
    }
    // Debounced: a search on every keystroke is a request per keystroke.
    const t = setTimeout(() => {
      setSearching(true)
      searchProjectManagers(q)
        .then((found) => {
          setHits(found)
          setFailed(null)
        })
        .catch((err) => {
          setHits([])
          setFailed(authErrorMessage(err, 'Could not search right now. Try again in a moment.'))
        })
        .finally(() => setSearching(false))
    }, 250)
    return () => clearTimeout(t)
  }, [query, open])

  async function assign(person: PersonHit) {
    setBusy(person.person_id)
    try {
      await assignProjectPm(projectId, person.person_id)
      show(`${person.first_name} ${person.last_name} now runs ${projectName}`)
      onClose()
      await onDone()
    } catch (err) {
      show(authErrorMessage(err, 'Could not assign them. Check the project still has no manager.'), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Assign a project manager"
      description={`Only people with Project manager turned on are listed. If they are not on ${projectName} yet, they join it.`}
      size="sm"
      focusField
      footer={
        <Button variant="ghost" onClick={onClose} disabled={busy !== null}>
          Cancel
        </Button>
      }
    >
      <div className="space-y-3">
        <Field label="Search by name">
          {(id) => (
            <Input
              id={id}
              autoComplete="off"
              placeholder="Name, or their exact email"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
        </Field>
        {query.trim().length > 0 && query.trim().length < 3 && (
          <p className="text-[12px] text-faint">Type at least three characters.</p>
        )}
        {searching && <p className="text-[12px] text-faint">Searching…</p>}
        {failed && <p className="text-[12px] text-danger-600 dark:text-danger-400">{failed}</p>}
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {hits.map((h) => (
            <li key={h.person_id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
              <Avatar profile={h} size={30} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-ink">
                  {h.first_name} {h.last_name}
                </span>
                {h.email && <span className="block truncate text-[12px] text-faint">{h.email}</span>}
              </span>
              <Button
                size="sm"
                loading={busy === h.person_id}
                disabled={busy !== null && busy !== h.person_id}
                onClick={() => void assign(h)}
              >
                Assign
              </Button>
            </li>
          ))}
          {!searching && !failed && query.trim().length >= 3 && hits.length === 0 && (
            <li className="px-1 py-2 text-[13px] text-muted">
              Nobody by that name has Project manager turned on. An admin can turn it on in Accounts.
            </li>
          )}
        </ul>
      </div>
    </Modal>
  )
}
