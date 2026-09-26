import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useLive } from '../hooks/useLive'
import { landingSpace, rememberSpace, useMySpaces } from '../hooks/useSpaces'
import { listMyGeneralProjects, listSpaceProjects } from '../lib/api/general'
import { authErrorMessage } from '../lib/authError'
import { projectRouteId, spaceRouteId } from '../lib/general/navigation'
import type { GeneralProjectSummary } from '../lib/general/types'
import { GeneralNavigationContext } from './generalNavigation'
import type { GeneralNavigationValue } from './generalNavigation'

type ProjectSpace = { projectId: string; spaceId: string }

export function GeneralNavigationProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: ReactNode
}) {
  const location = useLocation()
  const { spaces, invitations, error: spacesError, reload: reloadSpaces } = useMySpaces(enabled)
  const [reported, setReported] = useState<ProjectSpace | null>(null)
  const [projects, setProjects] = useState<GeneralProjectSummary[] | null>(null)
  const [projectError, setProjectError] = useState<string | null>(null)

  const explicitSpaceId = enabled ? spaceRouteId(location.pathname) : null
  const routeProjectId = enabled ? projectRouteId(location.pathname) : null
  const reportedId =
    routeProjectId && reported?.projectId === routeProjectId ? reported.spaceId : null
  const mine = (id: string | null) =>
    (id && spaces?.find((space) => space.id === id && space.my_level)) || null

  /**
   * A space URL names the space, full stop: when it resolves to nothing the
   * answer is nothing, and the page bounces to the picker.
   *
   * Anywhere else the reader keeps their own space. That matters most on a
   * project route, where the project's space may be one they were never in —
   * joining a project does not join its space — and letting that null out the
   * answer made the whole rail change under somebody who had only opened a
   * project of their own.
   */
  const fallbackId = enabled && spaces && !explicitSpaceId ? landingSpace(spaces) : null
  const currentSpace = explicitSpaceId
    ? mine(explicitSpaceId)
    : mine(reportedId) ?? mine(fallbackId)
  const currentSpaceId = currentSpace?.id ?? null

  useEffect(() => {
    if (!routeProjectId) setReported(null)
  }, [routeProjectId])

  useEffect(() => {
    if (currentSpace && !currentSpace.archived_at) rememberSpace(currentSpace.id)
  }, [currentSpace])

  const loadProjects = useCallback(async () => {
    if (!enabled) {
      setProjects(null)
      setProjectError(null)
      return
    }
    try {
      setProjects(currentSpaceId ? await listSpaceProjects(currentSpaceId) : await listMyGeneralProjects())
      setProjectError(null)
    } catch (err) {
      setProjectError(authErrorMessage(err, 'Could not load your projects.'))
      setProjects((previous) => previous ?? [])
    }
  }, [currentSpaceId, enabled])

  useEffect(() => {
    setProjects(null)
    void loadProjects()
  }, [loadProjects])

  // Nothing forgets the remembered space here any more. It used to be wiped
  // whenever a space URL resolved to nothing — which is somebody following a
  // link into a space they are not in, and cost them the space they did have.
  // A remembered id that has gone stale is already ignored by
  // chooseLandingSpace, so there is nothing to clean up.

  useLive(reloadSpaces, ['general_spaces', 'general_space_members', 'general_space_invitations'], {
    enabled,
  })
  useLive(
    loadProjects,
    ['general_projects', 'general_members', 'general_tasks'],
    { enabled },
  )

  const reload = useCallback(async () => {
    await reloadSpaces()
    await loadProjects()
  }, [loadProjects, reloadSpaces])

  const reportProjectSpace = useCallback((projectId: string, spaceId: string) => {
    setReported({ projectId, spaceId })
  }, [])

  const value = useMemo<GeneralNavigationValue>(
    () => ({
      spaces,
      invitations,
      currentSpaceId,
      currentSpace,
      projects,
      error: spacesError ?? projectError,
      reload,
      reportProjectSpace,
    }),
    [
      currentSpace,
      currentSpaceId,
      invitations,
      projectError,
      projects,
      reload,
      reportProjectSpace,
      spaces,
      spacesError,
    ],
  )

  return (
    <GeneralNavigationContext.Provider value={value}>
      {children}
    </GeneralNavigationContext.Provider>
  )
}
