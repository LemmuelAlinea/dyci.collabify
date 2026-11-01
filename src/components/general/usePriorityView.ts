// src/components/general/usePriorityView.ts
import { useMemo, useState } from 'react'
import { readPriorityView, writePriorityView } from '../../lib/general/taskFilters'
import type { PriorityView } from '../../lib/general/taskFilters'

/**
 * The Priority filter and sort for one list, remembered on this device. The
 * choice belongs to `id` (a project, or 'my-tasks'): another id reads its own
 * saved choice afresh.
 */
export function usePriorityView(id: string | undefined): [PriorityView, (next: PriorityView) => void] {
  const stored = useMemo(() => readPriorityView(id), [id])
  const [chosen, setChosen] = useState<{ id: string | undefined; view: PriorityView } | null>(null)
  const view = chosen && chosen.id === id ? chosen.view : stored

  function choose(next: PriorityView) {
    setChosen({ id, view: next })
    if (id) writePriorityView(id, next)
  }

  return [view, choose]
}
