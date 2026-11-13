import { useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../../../../components/ui/Icon'
import { Select } from '../../../../components/ui/Select'
import { useToast } from '../../../../components/ui/Toast'
import { setMemberOffice, setSpaceOffice } from '../../../../lib/api/offices'
import { authErrorMessage } from '../../../../lib/authError'
import { officeName } from '../../../../lib/offices'
import type { Office, OfficePerson, OfficeSpace } from '../../../../lib/offices'

const STATUS_NOTE: Record<OfficePerson['status'], string | null> = {
  active: null,
  pending: 'Not active yet',
  rejected: 'Account rejected',
}

const who = (p: OfficePerson) => p.name || p.email

/**
 * One office's people and spaces, or the Unassigned ones, each with Move to.
 * A move is one RPC and then a reload, so the row lands in its new office.
 */
export function OfficeDetail({
  eyebrow,
  title,
  description,
  actions,
  back,
  officeId,
  people,
  spaces,
  offices,
  onMoved,
}: {
  eyebrow: string
  title: string
  description: string
  actions?: ReactNode
  /** The phone's way back to the list. */
  back: ReactNode
  /** The live office shown, or null for Unassigned. */
  officeId: string | null
  people: OfficePerson[]
  spaces: OfficeSpace[]
  /** Live offices, sorted, for Move to. */
  offices: Office[]
  onMoved: () => Promise<void>
}) {
  const { show } = useToast()
  const [moving, setMoving] = useState<string | null>(null)
  const options = [
    ...offices.map((o) => ({ value: o.id, label: o.name })),
    { value: '', label: 'No office' },
  ]

  async function move(id: string, label: string, to: string, write: typeof setMemberOffice) {
    setMoving(id)
    try {
      await write(id, to || null)
      show(to ? `${label} moved to ${officeName(to, offices)}` : `${label} has no office now`)
      await onMoved()
    } catch (err) {
      show(authErrorMessage(err, `Could not move ${label}. Try again.`), 'error')
    } finally {
      setMoving(null)
    }
  }

  const moveTo = (id: string, label: string, write: typeof setMemberOffice) => (
    <div className="w-full shrink-0 sm:w-[210px]">
      <Select
        aria-label={`Move ${label} to`}
        value={officeId ?? ''}
        disabled={moving !== null}
        onChange={(e) => void move(id, label, e.target.value, write)}
        options={options}
        className="!h-10 text-[13px]"
      />
    </div>
  )

  return (
    <section data-office-detail className="surface overflow-hidden rounded-panel border border-line">
      <header className="border-b border-line bg-[var(--surface-sunken)] px-4 py-4 sm:px-5">
        <div className="sm:hidden">{back}</div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow text-faint">{eyebrow}</p>
            <h2 className="mt-1 break-words">{title}</h2>
            {description && (
              <p className="mt-1 max-w-[70ch] text-[13px] text-muted">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      </header>

      <div className="grid gap-6 p-4 sm:p-5 xl:grid-cols-2">
        <Group
          heading="People"
          count={people.length}
          empty={
            officeId
              ? 'Nobody is filed here yet. Move members here from Unassigned.'
              : 'Every member has an office.'
          }
        >
          {people.map((p) => (
            <Row
              key={p.id}
              icon="user"
              name={who(p)}
              detail={p.name ? p.email : null}
              note={STATUS_NOTE[p.status]}
              control={moveTo(p.id, who(p), setMemberOffice)}
            />
          ))}
        </Group>

        <Group
          heading="Work spaces"
          count={spaces.length}
          empty={
            officeId
              ? 'No work spaces are filed here yet.'
              : 'Every work space has an office.'
          }
        >
          {spaces.map((s) => (
            <Row
              key={s.id}
              icon="layoutGrid"
              name={s.name}
              detail={`${s.running_projects} running ${s.running_projects === 1 ? 'project' : 'projects'}`}
              note={null}
              control={moveTo(s.id, s.name, setSpaceOffice)}
            />
          ))}
        </Group>
      </div>
    </section>
  )
}

function Group({
  heading,
  count,
  empty,
  children,
}: {
  heading: string
  count: number
  empty: string
  children: ReactNode
}) {
  return (
    <div className="min-w-0">
      <h3 className="flex items-baseline gap-2 text-[15px] text-ink">
        {heading}
        <span className="font-mono text-[12px] text-faint">{count}</span>
      </h3>
      {count === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-line-strong px-4 py-5 text-[13px] text-muted">
          {empty}
        </p>
      ) : (
        <ul className="mt-2 space-y-2">{children}</ul>
      )}
    </div>
  )
}

function Row({
  icon,
  name,
  detail,
  note,
  control,
}: {
  icon: 'user' | 'layoutGrid'
  name: string
  detail: string | null
  note: string | null
  control: ReactNode
}) {
  return (
    <li className="surface flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line px-3.5 py-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-icon-tile text-icon-glyph">
        <Icon name={icon} size={15} />
      </span>
      <span className="min-w-0 flex-1 basis-[160px]">
        <span className="block truncate text-[14px] text-ink">{name}</span>
        {detail && <span className="block truncate text-[12px] text-muted">{detail}</span>}
        {note && (
          <span className="mt-1 inline-block rounded-md bg-pending-soft px-1.5 py-0.5 text-[11px] font-medium text-pending-ink">
            {note}
          </span>
        )}
      </span>
      {control}
    </li>
  )
}
