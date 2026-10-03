import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { listProfessorClasses, listStudentClasses } from '../../lib/api/classes'
import { listProjectsForClasses } from '../../lib/api/projects'
import { membershipOf } from '../../lib/access'
import type { AccessProfile, Membership } from '../../lib/access'
import { authErrorMessage } from '../../lib/authError'
import { paths } from '../../lib/paths'
import type { ClassSummary, ProjectSummary } from '../../lib/types'
import { Icon } from '../ui/Icon'
import { navFor } from './nav'

type Result = {
  key: string
  label: string
  detail: string
  to: string
}

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && close()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [close, open])
  return ref
}

function staticResults(profile: AccessProfile, membership: Membership | undefined): Result[] {
  return navFor(profile, true, membership).flatMap((group) =>
    [...(group.more ? [group.more] : []), ...group.items.filter((item) => !item.soon)].flatMap(
      (item) =>
        item.to ? [{ key: `nav:${item.to}`, label: item.label, detail: group.title, to: item.to }] : [],
    ),
  )
}

export function WorkspaceSearch({ onClose }: { onClose?: () => void }) {
  const { profile } = useAuth()
  const general = useGeneralNavigation()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [educationResults, setEducationResults] = useState<Result[]>([])
  const [error, setError] = useState<string | null>(null)
  const ref = useDismiss(open, () => setOpen(false))

  useEffect(() => {
    let cancelled = false
    async function loadEducation() {
      if (!profile || !profile.role) {
        setEducationResults([])
        setError(null)
        return
      }
      try {
        let classes: ClassSummary[] = []
        if (profile.role === 'student') classes = await listStudentClasses(profile.id)
        if (profile.role === 'faculty') classes = await listProfessorClasses(profile.id)

        const projects: ProjectSummary[] =
          profile.role === 'student' || profile.role === 'faculty'
            ? await listProjectsForClasses(classes.map((c) => c.id))
            : []
        if (cancelled) return

        setEducationResults([
          ...classes.map((cls) => ({
            key: `class:${cls.id}`,
            label: cls.name,
            detail: `Class · ${cls.initial}`,
            to: paths.class(cls.id),
          })),
          ...projects.map((project) => ({
            key: `project:${project.id}`,
            label: project.title,
            detail: `Project · ${project.class_initial}`,
            to: paths.classProject(project.id),
          })),
        ])
        setError(null)
      } catch (err) {
        if (!cancelled) setError(authErrorMessage(err, 'Search could not load.'))
      }
    }
    void loadEducation()
    return () => {
      cancelled = true
    }
  }, [profile])

  const allResults = useMemo<Result[]>(() => {
    if (!profile) return []
    const spaces = (general.spaces ?? [])
      .filter((space) => space.my_level && !space.archived_at && space.kind === 'work')
      .map((space) => ({
        key: `space:${space.id}`,
        label: space.name,
        detail: 'Space',
        to: paths.space(space.id),
      }))
    const projects = (general.projects ?? [])
      .filter((project) => !project.archived_at)
      .map((project) => ({
        key: `general-project:${project.id}`,
        label: project.name,
        detail: general.currentSpace ? `Project · ${general.currentSpace.name}` : 'Project',
        to: paths.project(project.id),
      }))
    const membership = membershipOf(general.spaces, general.myProjects)
    return [...staticResults(profile, membership), ...educationResults, ...spaces, ...projects]
  }, [educationResults, general.currentSpace, general.myProjects, general.projects, general.spaces, profile])

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return []
    return allResults
      .filter((result) => `${result.label} ${result.detail}`.toLowerCase().includes(needle))
      .slice(0, 8)
  }, [allResults, query])

  if (!profile) return null

  return (
    <div ref={ref} className="relative min-w-0 flex-1 sm:max-w-[420px]">
      <label className="sr-only" htmlFor="workspace-search">
        Search this workspace
      </label>
      <Icon
        name="search"
        size={16}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
      />
      <input
        id="workspace-search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            if (!query.trim()) {
              onClose?.()
            } else {
              setQuery('')
              setOpen(false)
            }
          }
        }}
        placeholder="Search Collabify"
        autoComplete="off"
        autoFocus
        className="h-10 w-full rounded-xl border border-line bg-[var(--surface)] pr-3 pl-9 text-[14px] text-ink outline-none transition focus:border-navy-300 focus:ring-4 focus:ring-navy-200/40 dark:focus:border-amber-300/50 dark:focus:ring-amber-300/10"
      />

      {open && query.trim() && (
        <div className="surface absolute left-0 z-50 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-line shadow-lift">
          {error ? (
            <p className="px-4 py-3 text-[13px] text-danger-600 dark:text-danger-300">{error}</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-muted">No results.</p>
          ) : (
            <ul className="py-1">
              {results.map((result) => (
                <li key={result.key}>
                  <Link
                    to={result.to}
                    onClick={() => {
                      setOpen(false)
                      setQuery('')
                      onClose?.()
                    }}
                    className="block px-4 py-2.5 text-[14px] hover:bg-[var(--surface-sunken)]"
                  >
                    <span className="block truncate font-medium text-ink">{result.label}</span>
                    <span className="block truncate text-[12px] text-muted">{result.detail}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
