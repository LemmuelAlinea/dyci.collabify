import { Navigate } from 'react-router-dom'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { PageLoading } from '../../components/ui/PageLoading'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { landingSpace } from '../../hooks/useSpaces'

/**
 * Where /general sends you.
 *
 * A space is part of the URL now, so this is the one page that has to decide
 * which one somebody meant. It picks the space they were last in — if they are
 * still in it — or their only space.
 *
 * Failing that it tries their projects, and only then the picker. Joining a
 * project never joins its space, so an account can hold several projects and no
 * space at all; sending that account to a picker headed "No spaces yet" told it
 * it had nothing while its work sat one row below.
 *
 * It renders nothing of its own unless the load failed, which has to be said
 * rather than read as emptiness.
 */
export default function GeneralLanding() {
  const { spaces, projects, error, reload } = useGeneralNavigation()

  if (error && spaces === null) {
    return (
      <div className="w-full space-y-4">
        <Alert tone="error">{error}</Alert>
        <Button onClick={() => void reload()}>Try again</Button>
      </div>
    )
  }

  if (spaces === null || projects === null) return <PageLoading />

  const id = landingSpace(spaces)
  if (id) return <Navigate to={`/general/spaces/${id}`} replace />
  if (projects.some((project) => project.my_level && !project.archived_at)) {
    return <Navigate to="/general/projects" replace />
  }
  return <Navigate to="/general/spaces" replace />
}
