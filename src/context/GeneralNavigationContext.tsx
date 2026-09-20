import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useLive } from '../hooks/useLive'
import { forgetSpace, landingSpace, rememberSpace, useMySpaces } from '../hooks/useSpaces'
import { listSpaceProjects } from '../lib/api/general'
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
  const fallbackId = enabled && spaces && !explicitSpaceId && !routeProjectId
    ? landingSpace(spaces)
    : null
  const candidateId = explicitSpaceId
    ?? (routeProjectId && reported?.projectId === routeProjectId ? reported.spaceId : null)
    ?? fallbackId
  const currentSpace = spaces?.find((space) => space.id === candidateId && space.my_level) ?? null
  const currentSpaceId = currentSpace?.id ?? null

  useEffect(() => {
    if (!routeProjectId) setReported(null)
  }, [routeProjectId])

  useEffect(() => {
    if (currentSpace && !currentSpace.archived_at) rememberSpace(currentSpace.id)
  }, [currentSpace])

  const loadProjects = useCallback(async () => {
    if (!enabled || !currentSpaceId) {
      setProjects(null)
      setProjectError(null)
      return
    }
    try {
      setProjects(await listSpaceProjects(currentSpaceId))
      setProjectError(null)
    } catch (err) {
      setProjectError(authErrorMessage(err, 'Could not load this space’s projects.'))
      setProjects((previous) => previous ?? [])
    }
  }, [currentSpaceId, enabled])

  useEffect(() => {
    setProjects(null)
    void loadProjects()
  }, [loadProjects])

  useEffect(() => {
    if (!enabled || spaces === null || !candidateId) return
    if (currentSpace) return
    if (!routeProjectId) forgetSpace()
  }, [candidateId, currentSpace, enabled, routeProjectId, spaces])

  useLive(reloadSpaces, ['general_spaces', 'general_space_members', 'general_space_invitations'], {
    enabled,
  })
  useLive(
    loadProjects,
    ['general_projects', 'general_members', 'general_tasks'],
    { enabled: enabled && Boolean(currentSpaceId) },
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
