import { Navigate, useParams } from 'react-router-dom'
import type { SpaceSettingsSection } from '../../lib/general/navigation'
import { paths } from '../../lib/paths'

/** Old tab links (`/spaces/:id/members`, `/teams`, `/teams/archive`, `/archive`) land in Settings. */
export default function SpaceLegacyRedirect({
  section,
  archived = false,
}: {
  section: SpaceSettingsSection
  archived?: boolean
}) {
  const { spaceId = '' } = useParams<{ spaceId: string }>()
  const to =
    section === 'teams'
      ? archived
        ? paths.spaceTeamsArchive(spaceId)
        : paths.spaceTeams(spaceId)
      : section === 'members'
        ? paths.spaceMembers(spaceId)
        : section === 'archive'
          ? paths.spaceArchive(spaceId)
          : paths.spaceSettings(spaceId)
  return <Navigate to={to} replace />
}
