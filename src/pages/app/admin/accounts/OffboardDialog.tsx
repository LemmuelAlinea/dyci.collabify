import { useState } from 'react'
import type { ReactNode } from 'react'
import { Alert } from '../../../../components/ui/Alert'
import { Button } from '../../../../components/ui/Button'
import { Field } from '../../../../components/ui/Field'
import { Icon } from '../../../../components/ui/Icon'
import { Modal } from '../../../../components/ui/Modal'
import { Select } from '../../../../components/ui/Select'
import { useToast } from '../../../../components/ui/Toast'
import { offboardMember } from '../../../../lib/api/offboarding'
import { authErrorMessage } from '../../../../lib/authError'
import { buildOverrides, handoverLines, readyToOffboard } from '../../../../lib/offboarding'
import type { OffboardLine } from '../../../../lib/offboarding'

type Person = { id: string; name: string }

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** One labelled group of lines: the label beside them on desktop, above them on a phone. */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="grid gap-x-6 gap-y-2 border-t border-line py-4 first:border-t-0 first:pt-0 md:grid-cols-[170px_1fr]">
      <h3 className="eyebrow pt-1 text-faint">{label}</h3>
      <ul className="min-w-0 space-y-2.5">{children}</ul>
    </section>
  )
}

/** Where a line lives, in the faint second line. */
function Where({ line, project }: { line: OffboardLine; project?: boolean }) {
  const parts = [project ? line.project_name : null, line.space_name, line.office_name].filter(Boolean)
  return (
    <span className="block truncate text-[12px] text-faint">
      {parts.join(' · ')}
      {line.archived && (
        <span className="ml-1.5 rounded-md surface-sunken px-1.5 py-px font-mono text-[11px] text-muted">
          Archived
        </span>
      )}
    </span>
  )
}

/**
 * Deactivate a member who still runs things, and hand it all over in one step.
 *
 * Every space and project defaults to the one successor chosen at the top; the
 * admin can send any of them to someone else. Teams, reviews and open tasks
 * are not picked here: the database empties the seats, moves the reviews to
 * each project's project manager and unassigns the tasks.
 */
export function OffboardDialog({
  person,
  candidates,
  lines,
  onClose,
  onDone,
  note,
}: {
  person: Person
  candidates: Person[]
  lines: OffboardLine[]
  onClose(): void
  onDone(): void
  /** Something the handover does not cover, such as the classes a teacher runs. */
  note?: ReactNode
}) {
  const { show } = useToast()
  const [successor, setSuccessor] = useState('')
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const spaces = lines.filter((l) => l.kind === 'space_pm')
  const projects = lines.filter((l) => l.kind === 'project_pm')
  const teams = lines.filter((l) => l.kind === 'team_lead')
  const reviews = lines.filter((l) => l.kind === 'reviewer')
  const tasks = lines.find((l) => l.kind === 'open_tasks')
  const options = candidates.map((c) => ({ value: c.id, label: c.name }))
  // Only spaces and projects need a successor. Without them there is nobody to pick: seats
  // are emptied, reviews go to each project's own project manager, tasks are unassigned.
  const needsSuccessor = handoverLines(lines).length > 0
  const ready = readyToOffboard(lines, successor || null)

  function close() {
    if (!busy) onClose()
  }

  async function confirm() {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      await offboardMember(person.id, successor || null, buildOverrides(lines, successor, picks))
      show(`${person.name} offboarded`)
      onDone()
    } catch (err) {
      // A Supabase error is a plain object; its message is the database's own refusal.
      setError(authErrorMessage(err, `Could not offboard ${person.name}. Nothing changed. Try again.`))
    } finally {
      setBusy(false)
    }
  }

  const handover = (l: OffboardLine) => {
    const value = (l.item_id && picks[l.item_id]) || successor
    return (
      <li
        key={`${l.kind}-${l.item_id}`}
        data-offboard-line={l.kind}
        className="grid items-center gap-x-3 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,220px)]"
      >
        <span className="min-w-0">
          <span className="block truncate text-[14px] text-ink">{l.item_name}</span>
          <Where line={l} />
        </span>
        <Icon name="arrowRight" size={15} className="hidden text-faint sm:block" />
        <Select
          aria-label={`Who runs ${l.item_name}`}
          value={value}
          disabled={busy || candidates.length === 0}
          placeholder={value ? undefined : 'Choose a person'}
          onChange={(e) => {
            const id = l.item_id
            if (id) setPicks((p) => ({ ...p, [id]: e.target.value }))
          }}
          options={options}
          className="!h-10 !text-[13px]"
        />
      </li>
    )
  }

  return (
    <Modal
      open
      onClose={close}
      title={`Offboard ${person.name}`}
      description={
        needsSuccessor
          ? `${person.name} stops signing in, and everything they run moves to someone else in one step. If any part is refused, nothing changes.`
          : `${person.name} stops signing in, and their seats, reviews and tasks go back to each project in one step. If any part is refused, nothing changes.`
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" className="!rounded-xl" loading={busy} disabled={!ready} onClick={confirm}>
            {needsSuccessor ? "Deactivate and hand over" : "Deactivate"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}
        {note}
        {needsSuccessor && candidates.length === 0 && (
          <Alert tone="info">
            Nobody can take over yet. Only an active member with Project manager on can. Turn on
            the Project manager switch for someone in Accounts, then deactivate {person.name} again.
          </Alert>
        )}

        {needsSuccessor && (
          <Field
            label="Hand everything to"
            hint={<span className="text-[12px] text-faint">People with Project manager on</span>}
          >
            {(id) => (
              <Select
                id={id}
                data-offboard-successor
                value={successor}
                disabled={busy || candidates.length === 0}
                placeholder="Choose a person"
                onChange={(e) => setSuccessor(e.target.value)}
                options={options}
              />
            )}
          </Field>
        )}

        <div className="rounded-xl border border-line px-4 py-4">
          {spaces.length > 0 && <Group label="Spaces they run">{spaces.map(handover)}</Group>}
          {projects.length > 0 && <Group label="Projects they run">{projects.map(handover)}</Group>}
          {teams.length > 0 && (
            <Group label="Teams they lead">
              {teams.map((l) => (
                <li key={l.item_id} data-offboard-line="team_lead" className="min-w-0">
                  <span className="block text-[14px] text-ink">
                    {l.item_name} <span className="text-muted">({l.project_name})</span>
                  </span>
                  <span className="block text-[12px] text-muted">Seat emptied. The project manager picks a lead.</span>
                </li>
              ))}
            </Group>
          )}
          {reviews.length > 0 && (
            <Group label="Reviews waiting on them">
              {reviews.map((l) => (
                <li key={l.item_id} data-offboard-line="reviewer" className="min-w-0">
                  <span className="block text-[14px] text-ink">{l.project_name}</span>
                  <span className="block text-[12px] text-muted">
                    {l.task_count}{' '}
                    {plural(
                      l.task_count,
                      "review moves to that project's project manager.",
                      "reviews move to that project's project manager.",
                    )}
                  </span>
                </li>
              ))}
            </Group>
          )}
          {tasks && (
            <Group label="Open tasks">
              <li data-offboard-line="open_tasks" className="text-[14px] text-ink">
                {tasks.task_count}{' '}
                {plural(
                  tasks.task_count,
                  'open task is unassigned and goes back to its team.',
                  'open tasks are unassigned and go back to their teams.',
                )}
              </li>
            </Group>
          )}
        </div>
      </div>
    </Modal>
  )
}
