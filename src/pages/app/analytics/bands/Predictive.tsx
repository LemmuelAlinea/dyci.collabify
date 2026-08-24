import { useState } from 'react'
import { BandHeader } from '../../../../components/analytics/BandHeader'
import { BurnCard } from '../../../../components/analytics/BurnCard'
import { ForecastSummary } from '../../../../components/analytics/ForecastSummary'
import { PressureChart } from '../../../../components/analytics/PressureChart'
import { EmptyState } from '../../../../components/ui/Tabs'
import type { useAnalytics } from '../useAnalytics'

const SHOWN = 6

/**
 * What is coming.
 *
 * Arithmetic, and the arithmetic is printed: work finished per day since a
 * board started, extended across what is left, against the days that remain.
 * No model and no score — one class and a handful of finished tasks would train
 * something confident and wrong, and it would have to be thrown away the moment
 * real history existed.
 */
export function Predictive({ data }: { data: ReturnType<typeof useAnalytics> }) {
  const { shownBurns, shownPressure, narrowedBelowClass } = data
  const [all, setAll] = useState(false)

  const atRisk = shownBurns.filter(
    (b) => !b.submitted_at && b.task_count > 0 && b.done_count < b.task_count,
  )

  return (
    <section className="space-y-5">
      <BandHeader
        kind="Predictive"
        title="Will the work land"
        body="Tasks finished per day since each board started, against the days it has left. Every figure here is a division you can redo by hand."
      />

      <ForecastSummary burns={shownBurns} />

      {atRisk.length === 0 ? (
        <EmptyState
          icon="check"
          title="Nothing outstanding"
          body="Every board in view is finished, handed in, or has no tasks on it yet."
        />
      ) : (
        <div className="space-y-3">
          <h3 className="text-[15px] text-ink">Board by board, slowest first</h3>
          <ul className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-3 max-sm:[&>*:only-child]:col-span-2">
            {(all ? atRisk : atRisk.slice(0, SHOWN)).map((b) => (
              <BurnCard key={b.board_id} burn={b} />
            ))}
          </ul>
          {atRisk.length > SHOWN && (
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              className="text-[12.5px] font-medium text-navy-600 hover:underline dark:text-navy-200"
            >
              {all ? 'Show fewer' : `Show the other ${atRisk.length - SHOWN}`}
            </button>
          )}
        </div>
      )}

      {/* Deadlines pile up per class; below one, the pile is not the question. */}
      {!narrowedBelowClass && (
        <div className="space-y-3">
          <h3 className="text-[15px] text-ink">What falls due next</h3>
          <p className="max-w-[66ch] text-[13.5px] text-muted">
            Open work by the week it is due, for the next four weeks. The only thing here that
            can still be moved before it happens.
          </p>
          <PressureChart rows={shownPressure} />
        </div>
      )}
    </section>
  )
}
