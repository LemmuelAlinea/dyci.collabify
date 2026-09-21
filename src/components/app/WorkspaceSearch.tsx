import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { listProfessorClasses, listStudentClasses } from '../../lib/api/classes'
import { listProjectsForClasses } from '../../lib/api/projects'
import { authErrorMessage } from '../../lib/authError'
import type { ClassSummary, ProjectSummary, Role } from '../../lib/types'
import type { Workplace } from '../../lib/workplace'
import { Icon } from '../ui/Icon'
import { navForWorkplace } from './nav'

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

function staticResults(workplace: Workplace, role: Role | null): Result[] {
  return navForWorkplace(workplace, role).flatMap((group) =>
    group.items
      .filter((item) => item.to && !item.soon)
      .map((item) => ({
        key: `nav:${item.to}`,
        label: item.label,
        detail: group.title,
        to: item.to!,
      })),
  )
}

export function WorkspaceSearch({ workplace }: { workplace: Workplace }) {
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
      if (!profile || workplace !== 'education' || !profile.role) {
        setEducationResults([])
        setError(null)
        return
      }
      try {
        let classes: ClassSummary[] = []
        if (profile.role === 'student') classes = await listStudentClasses(profile.id)
        if (profile.role === 'professor') classes = await listProfessorClasses(profile.id)

        const projects: ProjectSummary[] =
          profile.role === 'student' || profile.role === 'professor'
            ? await listProjectsForClasses(classes.map((c) => c.id))
            : []
        if (cancelled) return

        const roleRoot = `/${profile.role}`
        setEducationResults([
          ...classes.map((cls) => ({
            key: `class:${cls.id}`,
            label: cls.name,
            detail: `Class · ${cls.initial}`,
            to: `${roleRoot}/classes/${cls.id}`,
          })),
          ...projects.map((project) => ({
            key: `project:${project.id}`,
            label: project.title,
            detail: `Project · ${project.class_initial}`,
            to: `${roleRoot}/projects/${project.id}`,
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
  }, [profile, workplace])

  const allResults = useMemo<Result[]>(() => {
    if (!profile) return []
    if (workplace === 'general') {
      const spaces = (general.spaces ?? [])
        .filter((space) => space.my_level && !space.archived_at)
        .map((space) => ({
          key: `space:${space.id}`,
          label: space.name,
          detail: 'Space',
          to: `/general/spaces/${space.id}`,
        }))
      const projects = (general.projects ?? [])
        .filter((project) => !project.archived_at)
        .map((project) => ({
          key: `general-project:${project.id}`,
          label: project.name,
          detail: general.currentSpace ? `Project · ${general.currentSpace.name}` : 'Project',
          to: `/general/projects/${project.id}`,
        }))
      return [...staticResults(workplace, profile.role), ...spaces, ...projects]
    }
    return [...staticResults(workplace, profile.role), ...educationResults]
  }, [educationResults, general.currentSpace, general.projects, general.spaces, profile, workplace])

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
        placeholder={`Search ${workplace === 'general' ? 'General' : 'Education'}`}
        autoComplete="off"
        className="h-10 w-full rounded-xl border border-line bg-[var(--surface)] pr-3 pl-9 text-[14px] text-ink outline-none transition focus:border-navy-300 focus:ring-4 focus:ring-navy-200/40 dark:focus:border-amber-300/50 dark:focus:ring-amber-300/10"
      />

      {open && query.trim() && (
        <div className="surface absolute left-0 z-50 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-line shadow-lift">
          {error ? (
            <p className="px-4 py-3 text-[13px] text-red-600 dark:text-red-300">{error}</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-muted">No results in this workspace.</p>
          ) : (
            <ul className="py-1">
              {results.map((result) => (
                <li key={result.key}>
                  <Link
                    to={result.to}
                    onClick={() => {
                      setOpen(false)
                      setQuery('')
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
