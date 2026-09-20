import { Navigate } from 'react-router-dom'
import { PageLoading } from '../../components/ui/PageLoading'
import { landingSpace, useMySpaces } from '../../hooks/useSpaces'

/**
 * Where /general sends you.
 *
 * A space is part of the URL now, so this is the one page that has to decide
 * which one somebody meant. It picks the space they were last in — if they are
 * still in it — or their only space. With none or several it hands them the
 * picker, because choosing for them there would be guessing.
 *
 * It renders nothing of its own. Every /general link in the product still
 * works, and lands somewhere real.
 */
export default function GeneralLanding() {
  const { spaces } = useMySpaces()

  if (spaces === null) return <PageLoading />

  const id = landingSpace(spaces)
  return <Navigate to={id ? `/general/spaces/${id}` : '/general/spaces'} replace />
}
