import { BandHeader } from '../../../../components/analytics/BandHeader'
import { GapList } from '../../../../components/analytics/GapList'
import { MemberLoad } from '../../../../components/analytics/MemberLoad'
import { PaceCard } from '../../../../components/analytics/PaceCard'
import { UnmeasuredList } from '../../../../components/analytics/UnmeasuredList'
import { Icon } from '../../../../components/ui/Icon'
import type { useAnalytics } from '../useAnalytics'

function Tile({ value, label, tone }: { value: number | string; label: string; tone?: 'warn' }) {
  return (
    <div className="surface rounded-card border border-line px-4 py-3 shadow-card">
      <p
        className={`font-mono text-[19px] ${
          tone === 'warn' && value !== 0 ? 'text-red-600 dark:text-red-400' : 'text-ink'
        }`}
      >
        {value}
      </p>
      <p className="text-[12px] text-muted">{label}</p>
    </div>
  )
}

/**
 * What has happened. Counted, never estimated — every figure here is a row
 * somebody wrote, and nothing in this band is projected forward.
 */
export function Descriptive({ data }: { data: ReturnType<typeof useAnalytics> }) {
  const { totals, shownPace, shownGaps, shownUnmeasured, shownMembers, narrowedBelowClass } = data

  return (
    <section className="space-y-5">
      <BandHeader
        kind="Descriptive"
        title="Where the work stands"
        body="Counted from what has happened. Nothing in this band is projected or inferred."
      />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 xl:grid-cols-6">
        <Tile value={`${totals.done}/${totals.tasks}`} label="tasks done" />
        <Tile value={totals.boards} label="boards" />
        <Tile value={totals.submitted} label="handed in" />
        <Tile value={totals.accepted} label="accepted" />
        <Tile value={totals.returned} label="returned" />
        <Tile value={totals.late} label="handed in late" tone="warn" />
      </div>

      {(totals.empty > 0 || totals.unclaimed > 0) && (
        <p className="flex items-start gap-2 text-[13px] text-muted">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-amber-500" />
          {totals.empty > 0 &&
            `${totals.empty} board${totals.empty === 1 ? '' : 's'} with no tasks`}
          {totals.empty > 0 && totals.unclaimed > 0 && ' · '}
          {totals.unclaimed > 0 &&
            `${totals.unclaimed} task${totals.unclaimed === 1 ? '' : 's'} nobody has claimed`}
        </p>
      )}

      {/* A syllabus belongs to a class, so it stops mattering once the question
          is about one group or one person. */}
      {!narrowedBelowClass && shownPace.length > 0 && (
        <>
          <div className="space-y-3">
            {shownPace.map((p) => (
              <PaceCard key={p.class_id} pace={p} />
            ))}
          </div>

          <div className="space-y-3">
            <h3 className="text-[15px] text-ink">Weeks with nothing set</h3>
            <GapList gaps={shownGaps} />
          </div>
        </>
      )}

      {!narrowedBelowClass && <UnmeasuredList rows={shownUnmeasured} />}

      <div className="space-y-3">
        <h3 className="text-[15px] text-ink">Who is carrying the work</h3>
        <p className="max-w-[66ch] text-[13.5px] text-muted">
          Effort, not marks. A group at eighty per cent looks the same whether everyone did a
          share or one person did all of it.
        </p>
        <MemberLoad rows={shownMembers} />
      </div>
    </section>
  )
}
