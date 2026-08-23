import { useEffect, useMemo, useState } from 'react'
import { Avatar } from '../app/Avatar'
import { Alert } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { listMembers, listProfessorClasses } from '../../lib/api/classes'
import { START_DM_MESSAGE, startDirectConversation } from '../../lib/api/messages'
import { authErrorMessage } from '../../lib/authError'
import { byLastName, fullName } from '../../lib/types'
import type { Profile } from '../../lib/types'

type Candidate = Pick<Profile, 'id' | 'first_name' | 'middle_name' | 'last_name' | 'avatar_url'> & {
  classes: string[]
}

/** Professors only — a student cannot open a direct thread. */
export function NewDirectDialog({
  open,
  onClose,
  professorId,
  onStarted,
}: {
  open: boolean
  onClose: () => void
  professorId: string
  onStarted: (conversationId: string) => void
}) {
  const [people, setPeople] = useState<Candidate[] | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setPeople(null)
    setQuery('')
    setError(null)

    void (async () => {
      try {
        const classes = await listProfessorClasses(professorId)
        const rosters = await Promise.all(classes.map((c) => listMembers(c.id)))

        // The same student can sit in several classes — one row, both listed.
        const merged = new Map<string, Candidate>()
        rosters.forEach((roster, i) => {
          for (const m of roster) {
            const existing = merged.get(m.student_id)
            if (existing) existing.classes.push(classes[i].initial)
            else merged.set(m.student_id, { ...m.profile, classes: [classes[i].initial] })
          }
        })
        setPeople([...merged.values()].sort(byLastName))
      } catch (err) {
        setError(authErrorMessage(err, 'Could not load your students.'))
        setPeople([])
      }
    })()
  }, [open, professorId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return people ?? []
    return (people ?? []).filter((p) => fullName(p).toLowerCase().includes(q))
  }, [people, query])

  async function start(studentId: string) {
    setBusyId(studentId)
    setError(null)
    try {
      const { result, conversation_id } = await startDirectConversation(studentId)
      if (result === 'ok' && conversation_id) {
        onClose()
        onStarted(conversation_id)
      } else if (result !== 'ok') {
        setError(START_DM_MESSAGE[result])
      }
    } catch (err) {
      setError(authErrorMessage(err, 'Could not start that conversation.'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New message"
      description="Pick a student from one of your classes."
      size="sm"
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        <div className="relative">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search students"
            className="h-11 w-full rounded-xl border border-[var(--control-line)] bg-[var(--surface)] pr-3 pl-9 text-[14px] text-ink placeholder:text-[var(--ink-faint)] hover:border-[var(--line-strong)] focus:border-navy-400 focus:ring-4 focus:ring-navy-500/12"
          />
        </div>

        {people === null ? (
          <div className="flex items-center gap-2.5 py-8 text-[14px] text-muted">
            <Spinner size={16} />
            Loading students…
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-[13.5px] text-muted">
            {people.length === 0
              ? 'No students have joined your classes yet.'
              : 'Nobody matches that search.'}
          </p>
        ) : (
          <ul className="-mx-2 max-h-[320px] overflow-y-auto">
            {filtered.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => start(p.id)}
                  disabled={busyId === p.id}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-[var(--surface-sunken)] disabled:opacity-60"
                >
                  <Avatar profile={p} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] text-ink">
                      {p.last_name}, {p.first_name}
                    </span>
                    <span className="block truncate text-[12px] text-faint">
                      {[...new Set(p.classes)].join(' · ')}
                    </span>
                  </span>
                  {busyId === p.id && <Spinner size={15} className="text-muted" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
