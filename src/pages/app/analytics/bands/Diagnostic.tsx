import { BandHeader } from '../../../../components/analytics/BandHeader'
import { DiagnosisList } from '../../../../components/analytics/DiagnosisList'
import { ParticipationList } from '../../../../components/analytics/ParticipationList'
import type { useAnalytics } from '../useAnalytics'

/**
 * Why the work is where it is.
 *
 * Only causes with evidence behind them: unclaimed tasks, a board nobody has
 * opened, work held by somebody who left, one member holding half of it. The
 * database does not know whether a group has fallen out, and a page that
 * guessed at that would be worse than one that stays quiet.
 */
export function Diagnostic({ data }: { data: ReturnType<typeof useAnalytics> }) {
  const { shownDiagnoses, shownPeople, narrowedBelowClass } = data

  return (
    <section className="space-y-5">
      <BandHeader
        kind="Diagnostic"
        title="Why it is behind"
        body="Each cause is measured, and the number that shows it sits in the line. Boards with nothing to explain are left out."
      />

      <DiagnosisList rows={shownDiagnoses} />

      {/* Membership belongs to a class. Below one, "in no group" has no meaning. */}
      {!narrowedBelowClass && shownPeople.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-[15px] text-ink">Who the work has not reached</h3>
          <p className="max-w-[66ch] text-[13.5px] text-muted">
            Every other figure on this page is built from what people produced, so somebody who
            has produced nothing is invisible to all of them.
          </p>
          <ParticipationList rows={shownPeople} />
        </div>
      )}
    </section>
  )
}
