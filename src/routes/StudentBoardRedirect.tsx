import { Navigate, useLocation, useParams } from 'react-router-dom'
import { paths } from '../lib/paths'

/**
 * A board's page is the professor's; a student lands on the project itself.
 * The query comes along, so a search hit's `tab=files&path=` opens the same
 * folder in the student's own group's Files. The board page's other tabs
 * (overview, plan, grade) mean nothing on the project and are dropped.
 */
export function StudentBoardRedirect() {
  const { projectId = '' } = useParams()
  const { search } = useLocation()
  const params = new URLSearchParams(search)
  if (params.has('tab') && params.get('tab') !== 'files') params.delete('tab')
  const query = params.toString()
  return <Navigate to={`${paths.classProject(projectId)}${query ? `?${query}` : ''}`} replace />
}
