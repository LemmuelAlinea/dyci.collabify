import { ActionList } from '../../../../components/analytics/ActionList'
import { BandHeader } from '../../../../components/analytics/BandHeader'
import type { useAnalytics } from '../useAnalytics'

/**
 * What to do now.
 *
 * The payoff of the three bands above: each recommendation carries the evidence
 * that produced it and links to the place that already performs the fix. It
 * advises and points; it does not act. An irreversible act belongs where the
 * professor can see what they are doing, not one click from a chart.
 */
export function Prescriptive({ data }: { data: ReturnType<typeof useAnalytics> }) {
  return (
    <section className="space-y-5">
      <BandHeader
        kind="Prescriptive"
        title="What to do now"
        body="Ordered by how much it costs to leave it. Each one says what the evidence is and opens where the fix lives."
      />
      <ActionList actions={data.actions} />
    </section>
  )
}
