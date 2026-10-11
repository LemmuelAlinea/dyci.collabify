import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useLive } from '../hooks/useLive'
import { landingSpace, rememberSpace, useMySpaces } from '../hooks/useSpaces'
import { listMyGeneralProjects, listSpaceProjects } from '../lib/api/general'
import { listProjectsForClasses } from '../lib/api/projects'
import { authErrorMessage } from '../lib/authError'
import { projectRouteId, spaceRouteId } from '../lib/general/navigation'
import type { GeneralProjectSummary } from '../lib/general/types'
import { isReleased } from '../lib/types'
import type { ProjectSummary } from '../lib/types'
import { useAuth } from './AuthContext'
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
  const isStudent = useAuth().profile?.role === 'student'
  const [classProjects, setClassProjects] = useState<ProjectSummary[] | null>(null)
  const { spaces, invitations, error: spacesError, reload: reloadSpaces } = useMySpaces(enabled)
  const [reported, setReported] = useState<ProjectSpace | null>(null)
  // Only holds a fetch of its own while a space is in view; with no current
  // space, `projects` below reuses `myProjects` instead of asking the server
  // the same listMyGeneralProjects() question twice.
  const [spaceProjects, setSpaceProjects] = useState<GeneralProjectSummary[] | null>(null)
  const [myProjects, setMyProjects] = useState<GeneralProjectSummary[] | null>(null)
  const [projectError, setProjectError] = useState<string | null>(null)
  const [mineError, setMineError] = useState<string | null>(null)

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
    // A class space is never a landing choice — landingSpace only ever offers
    // a work space — so remembering one here would just be a stale write.
    if (currentSpace && currentSpace.kind === 'work' && !currentSpace.archived_at) {
      rememberSpace(currentSpace.id)
    }
  }, [currentSpace])

  const loadProjects = useCallback(async () => {
    if (!enabled || !currentSpaceId) {
      // No space in view: `projects` below falls back to `myProjects`, which
      // `loadMine` already fetches with the same call.
      setSpaceProjects(null)
      setProjectError(null)
      return
    }
    try {
      setSpaceProjects(await listSpaceProjects(currentSpaceId))
      setProjectError(null)
    } catch (err) {
      setProjectError(authErrorMessage(err, 'Could not load your projects.'))
      setSpaceProjects((previous) => previous ?? [])
    }
  }, [currentSpaceId, enabled])

  /**
   * Kept apart from `projects`, which is whatever the space in view holds — a
   * space member reads every project in it, including ones they are not on.
   * This is the other list: the projects that are the reader's own, wherever
   * they live. The sidebar and the home page are built from it, so neither
   * changes when the space does.
   */
  const loadMine = useCallback(async () => {
    if (!enabled) {
      setMyProjects(null)
      return
    }
    try {
      setMyProjects(await listMyGeneralProjects())
      setMineError(null)
    } catch (err) {
      // With no space in view this is the only project fetch, so a failure has
      // to say so; an empty list would read as "you have no projects".
      setMineError(authErrorMessage(err, 'Could not load your projects.'))
      setMyProjects((previous) => previous ?? [])
    }
  }, [enabled])

  useEffect(() => {
    setSpaceProjects(null)
    void loadProjects()
  }, [loadProjects])

  useEffect(() => {
    void loadMine()
  }, [loadMine])

  // The ids as one string, so a spaces refresh that changes nothing about the
  // reader's classes does not refetch their projects.
  const spacesReady = spaces !== null
  const classIds = (spaces ?? [])
    .filter((space) => space.kind === 'education' && space.my_level && space.class_id && !space.archived_at)
    .map((space) => space.class_id!)
    .sort()
    .join(',')

  /**
   * Class projects for the rail's Quick access. A student sees only what has
   * opened to them; a professor sees their drafts too, since those are work
   * they are in the middle of. Failing quietly is fine here: the rail just
   * shows work projects, and the Projects page reports its own errors.
   */
  const loadClassProjects = useCallback(async () => {
    if (!enabled || !spacesReady) {
      setClassProjects(null)
      return
    }
    try {
      const all = await listProjectsForClasses(classIds ? classIds.split(',') : [])
      setClassProjects(
        all.filter((project) => (isStudent ? isReleased(project) : !project.archived_at)),
      )
    } catch {
      setClassProjects((previous) => previous ?? [])
    }
  }, [classIds, enabled, isStudent, spacesReady])

  useEffect(() => {
    void loadClassProjects()
  }, [loadClassProjects])

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
  useLive(loadMine, ['general_projects', 'general_members'], { enabled })
  useLive(loadClassProjects, ['projects'], { enabled })

  const reload = useCallback(async () => {
    await Promise.all([reloadSpaces(), loadProjects(), loadMine(), loadClassProjects()])
  }, [loadClassProjects, loadMine, loadProjects, reloadSpaces])

  const reportProjectSpace = useCallback((projectId: string, spaceId: string) => {
    setReported({ projectId, spaceId })
  }, [])

  // With no current space, this reuses `myProjects` — the reader's own
  // projects, wherever they live — instead of a second fetch of the same
  // "my projects" question `loadProjects` would otherwise repeat.
  const projects = currentSpaceId ? spaceProjects : myProjects

  const value = useMemo<GeneralNavigationValue>(
    () => ({
      spaces,
      invitations,
      currentSpaceId,
      currentSpace,
      projects,
      myProjects,
      classProjects,
      error: spacesError ?? projectError ?? mineError,
      reload,
      reportProjectSpace,
    }),
    [
      classProjects,
      currentSpace,
      currentSpaceId,
      invitations,
      myProjects,
      projectError,
      mineError,
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
