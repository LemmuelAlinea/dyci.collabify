import { useId, useState } from 'react'
import { Icon } from '../ui/Icon'
import { ROLE_LABEL, ROLE_MATRIX } from '../../lib/general/permissions'
import type { ProjectRole, RoleMark } from '../../lib/general/permissions'

const COLUMNS: { key: ProjectRole | 'lead'; label: string }[] = [
  { key: 'pm', label: ROLE_LABEL.pm },
  { key: 'coordinator', label: ROLE_LABEL.coordinator },
  { key: 'lead', label: 'Team lead' },
  { key: 'member', label: ROLE_LABEL.member },
  { key: 'qa', label: ROLE_LABEL.qa },
  { key: 'stakeholder', label: ROLE_LABEL.stakeholder },
]

const MARK_WORDS: Record<RoleMark, string> = {
  yes: 'Yes',
  team: 'Their team',
  grant: 'If granted',
  own: 'Their own',
  read: 'Read only',
}

/**
 * "Who can do what", straight from ROLE_MATRIX. Closed until somebody wants
 * it, and the table scrolls sideways inside itself on a phone so the page
 * never does.
 */
export function RoleGuide() {
  const [open, setOpen] = useState(false)
  const panelId = useId()

  return (
    <section className="rounded-panel border border-line surface">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 rounded-panel px-4 py-3.5 text-left sm:px-5"
      >
        <span>
          <span className="block text-[15px] font-medium text-ink">Who can do what</span>
          <span className="mt-0.5 block text-[12px] text-muted">
            What each role does in this project, and what the project manager can grant.
          </span>
        </span>
        <Icon
          name="chevronDown"
          size={17}
          className={`shrink-0 text-faint transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div id={panelId} className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[44rem] border-collapse text-left text-[12px]">
            <thead>
              <tr className="surface-sunken">
                <th scope="col" className="sticky left-0 z-10 surface-sunken px-4 py-2.5 font-medium text-muted sm:px-5">
                  Action
                </th>
                {COLUMNS.map((c) => (
                  <th key={c.key} scope="col" className="px-3 py-2.5 font-medium text-muted">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {ROLE_MATRIX.map((row) => (
                <tr key={row.action}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 w-[16rem] min-w-[14rem] surface px-4 py-2.5 font-normal text-ink sm:px-5"
                  >
                    {row.action}
                  </th>
                  {COLUMNS.map((c) => {
                    const mark = row.roles[c.key]
                    return (
                      <td key={c.key} className={`whitespace-nowrap px-3 py-2.5 ${mark === 'yes' ? 'text-ink' : 'text-muted'}`}>
                        {mark ? MARK_WORDS[mark] : ''}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
