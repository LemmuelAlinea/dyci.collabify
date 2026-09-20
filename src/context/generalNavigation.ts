import { createContext, useContext } from 'react'
import type {
  GeneralProjectSummary,
  GeneralSpaceSummary,
  MySpaceInvitation,
} from '../lib/general/types'

export type GeneralNavigationValue = {
  spaces: GeneralSpaceSummary[] | null
  invitations: MySpaceInvitation[]
  currentSpaceId: string | null
  currentSpace: GeneralSpaceSummary | null
  projects: GeneralProjectSummary[] | null
  error: string | null
  reload: () => Promise<void>
  reportProjectSpace: (projectId: string, spaceId: string) => void
}

export const GeneralNavigationContext = createContext<GeneralNavigationValue | null>(null)

export function useGeneralNavigation() {
  const value = useContext(GeneralNavigationContext)
  if (!value) throw new Error('useGeneralNavigation must be used inside GeneralNavigationProvider')
  return value
}
