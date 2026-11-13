import { Link } from 'react-router-dom'
import { Alert } from '../../../../components/ui/Alert'
import { Icon } from '../../../../components/ui/Icon'
import type { IconName } from '../../../../components/ui/Icon'
import { orgSummary } from '../../../../lib/api/offices'
import { paths } from '../../../../lib/paths'
import { Band, BandLoading } from './Band'
import { useRead } from './useRead'

/** Two counts that open their pages. Zero reads as 0: it is an answer, not a gap. */
export function SetupBand({ className = '' }: { className?: string }) {
  const { data, failed, load } = useRead(orgSummary)

  return (
    <Band name="setup" eyebrow="Follow-ups" title="Accounts and privacy" className={className}>
      {failed ? (
        <Alert tone="error" onRetry={load}>
          The account and privacy counts did not load. Try again in a moment.
        </Alert>
      ) : data === null ? (
        <BandLoading>Reading the counts…</BandLoading>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <Count
            to={paths.admin.accounts}
            icon="users"
            label="Accounts in setup"
            note="Imported accounts that have not finished their first sign-in."
            value={data.accounts_in_setup}
          />
          <Count
            to={paths.admin.privacy}
            icon="shield"
            label="Privacy requests due"
            note="Due within two days, or past their date."
            value={data.privacy_due}
            urgent
          />
        </div>
      )}
    </Band>
  )
}

function Count({
  to,
  icon,
  label,
  note,
  value,
  urgent = false,
}: {
  to: string
  icon: IconName
  label: string
  note: string
  value: number
  /** A nonzero count here is a deadline, so it reads in the attention colour. */
  urgent?: boolean
}) {
  return (
    <Link
      to={to}
      className="flex items-start gap-3 rounded-card border border-line p-3.5 transition-colors hover:border-line-strong"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-icon-tile text-icon-glyph">
        <Icon name={icon} size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-muted">{note}</span>
      </span>
      <span
        data-count
        className={`font-mono text-[22px] leading-none font-bold ${
          urgent && value > 0 ? 'text-warning-700 dark:text-warning-300' : 'text-ink'
        }`}
      >
        {value}
      </span>
    </Link>
  )
}
