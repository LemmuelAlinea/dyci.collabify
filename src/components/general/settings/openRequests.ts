// src/components/general/settings/openRequests.ts
import type { GeneralProjectState } from '../useGeneralProject'

/**
 * Open requests waiting in Settings → Members & permissions, for the Settings
 * tab badge and the section menu: access requests for whoever answers them
 * (canGrant), plus join requests for the project manager and coordinators
 * while the project is not archived, as JoinRequestsPanel shows them.
 */
export function openSettingsRequests(
  state: Pick<GeneralProjectState, 'canGrant' | 'archived' | 'myRole' | 'requests' | 'joinRequests'>,
): number {
  const access = state.canGrant ? state.requests.filter((r) => r.status === 'open').length : 0
  const answersJoins = state.canGrant && !state.archived && (state.myRole === 'pm' || state.myRole === 'coordinator')
  const joins = answersJoins ? state.joinRequests.filter((r) => r.status === 'open').length : 0
  return access + joins
}
