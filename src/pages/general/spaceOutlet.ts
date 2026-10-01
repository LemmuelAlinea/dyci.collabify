import { useOutletContext } from 'react-router-dom'
import type { useGeneralDashboard } from '../../hooks/useGeneralDashboard'
import type { GeneralProjectSummary } from '../../lib/general/types'

/** What SpaceLayout hands each of its tabs. */
export type SpaceOutlet = {
  /** The space's live projects, archived ones left out. */
  all: GeneralProjectSummary[]
  dashboard: ReturnType<typeof useGeneralDashboard>
  canStart: boolean
  openNewProject: () => void
}

export const useSpaceOutlet = () => useOutletContext<SpaceOutlet>()
