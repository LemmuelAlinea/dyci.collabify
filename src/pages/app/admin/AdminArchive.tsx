import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { Icon, Spinner } from '../../../components/ui/Icon'
import type { IconName } from '../../../components/ui/Icon'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../context/AuthContext'
import { useLive } from '../../../hooks/useLive'
import { deleteSection, listArchivedSections, updateSection } from '../../../lib/api/program'
import {
  archiveResource,
  deleteResourceForGood,
  listArchivedResources,
} from '../../../lib/api/resources'
import { authErrorMessage } from '../../../lib/authError'
import type { ProgramSection } from '../../../lib/program'
import type { TeachingResource } from '../../../lib/types'

type Kind = 'section' | 'syllabus' | 'curriculum'

type Row = {
  kind: Kind
  id: string
  name: string
  meta: string
  archivedAt: string | null
  /** Null when this admin may act on it, else why not. */
  blocked: string | null
}

const GROUPS: { kind: Kind; title: string; icon: IconName; noun: string; hint: string }[] = [
  {
    kind: 'section',
    title: 'Sections',
    icon: 'kanban',
    noun: 'section',
    hint: 'Archive a section from its row on the Sections page.',
  },
  {
    kind: 'syllabus',
    title: 'Published syllabi',
    icon: 'file',
    noun: 'syllabus',
    hint: 'Archive a published syllabus from its menu on the Syllabi page.',
  },
  {
    kind: 'curriculum',
    title: 'Published curricula',
    icon: 'target',
    noun: 'curriculum',
    hint: 'Archive a published curriculum from its menu on the Curriculum page.',
  },
]

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''

function fromSection(s: ProgramSection): Row {
  return {
    kind: 'section',
    id: s.id,
    name: s.name,
    meta: `${s.year_level} year · ${s.school_year}`,
    archivedAt: s.archived_at,
    blocked: null,
  }
}

function fromResource(r: TeachingResource, me: string | undefined): Row {
  return {
    kind: r.kind === 'syllabus' ? 'syllabus' : 'curriculum',
    id: r.id,
    name: r.title,
    meta: r.file_name,
    archivedAt: r.archived_at ?? null,
    blocked: r.professor_id === me ? null : 'Only the admin who published it can restore or delete it.',
  }
}

/**
 * The program office's archive: every section, published syllabus and
 * published curriculum an admin put away, in one place. Restore puts it back
 * where it was; Delete for good removes it at once, after a confirmation.
 *
 * Classes keep their section as text, so deleting a section never touches a
 * class. A deleted syllabus or curriculum is taken off any class using it.
 */
export default function AdminArchive() {
  const { profile } = useAuth()
  const { show } = useToast()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const me = profile?.id

  const load = useCallback(async () => {
    try {
      const [sections, syllabi, curricula] = await Promise.all([
        listArchivedSections(),
        listArchivedResources('syllabus', 'program'),
        listArchivedResources('curriculum', 'program'),
      ])
      setRows([
        ...sections.map(fromSection),
        ...[...syllabi, ...curricula].map((r) => fromResource(r, me)),
      ])
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the archive.'))
      setRows((prev) => prev ?? [])
    }
  }, [me])

  useEffect(() => {
    document.title = 'Archive · Collabify'
    void load()
  }, [load])

  useLive(load, ['program_sections', 'teaching_resources'])

  async function restore(row: Row) {
    setBusy(row.id)
    try {
      if (row.kind === 'section') await updateSection(row.id, { archived_at: null })
      else await archiveResource(row.id, false)
      show(`${row.name} restored`)
      await load()
    } catch (err) {
      show(authErrorMessage(err, `Could not restore ${row.name}. Try again.`), 'error')
    } finally {
      setBusy(null)
    }
  }

  const total = rows?.length ?? 0

  return (
    <div className="space-y-6">
      <DirectoryHero
        title="Program"
        accent="archive."
        description="Sections, syllabi and curricula you put away wait here. Restore puts one back where it was. Delete for good removes it at once."
      />

      {error && (
        <Alert tone="error" onRetry={load}>
          {error}
        </Alert>
      )}

      {rows === null ? (
        <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
          <Spinner size={16} />
          Loading the archive…
        </div>
      ) : (
        <>
          <p className="font-mono text-[12px] text-faint">
            {total} archived {total === 1 ? 'item' : 'items'}
          </p>
          <div className="grid gap-6 xl:grid-cols-2">
            {GROUPS.map((g) => {
              const items = rows
                .filter((r) => r.kind === g.kind)
                .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''))
              return (
                <Panel key={g.kind} title={g.title} count={items.length} icon={g.icon}>
                  {items.length === 0 ? (
                    <p className="px-4 py-5 text-[13px] text-muted sm:px-5">{g.hint}</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {items.map((row) => (
                        <li
                          key={row.id}
                          className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
                        >
                          <span className="min-w-0 flex-1 basis-[200px]">
                            <span className="block truncate text-[14px] text-ink">{row.name}</span>
                            <span className="block truncate text-[12px] text-muted">
                              {row.meta}
                              {row.archivedAt ? ` · archived ${day(row.archivedAt)}` : ''}
                            </span>
                            {row.blocked && (
                              <span className="mt-0.5 block text-[12px] text-faint">{row.blocked}</span>
                            )}
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="!rounded-xl"
                              loading={busy === row.id}
                              disabled={row.blocked !== null || (busy !== null && busy !== row.id)}
                              onClick={() => void restore(row)}
                            >
                              <Icon name="refresh" size={14} />
                              Restore
                            </Button>
                            <Button
                              size="sm"
                              variant="destroy"
                              className="!rounded-xl"
                              disabled={row.blocked !== null || busy !== null}
                              onClick={() => setDeleting(row)}
                            >
                              <Icon name="trash" size={14} />
                              Delete for good
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              )
            })}
          </div>
        </>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'this'} for good?`}
        body={
          deleting?.kind === 'section'
            ? 'The section and its faculty assignments are deleted and cannot be recovered. Classes already under this name keep running and keep the name.'
            : `The ${deleting?.kind === 'syllabus' ? 'syllabus' : 'curriculum'} and its file are deleted and cannot be recovered. Any class using it loses it${deleting?.kind === 'syllabus' ? ', along with its week map' : ''}.`
        }
        confirmLabel="Delete for good"
        onConfirm={async () => {
          if (!deleting) return
          if (deleting.kind === 'section') await deleteSection(deleting.id)
          else await deleteResourceForGood(deleting.id)
          show(`${deleting.name} deleted`)
          await load()
        }}
      />
    </div>
  )
}

function Panel({
  title,
  count,
  icon,
  children,
}: {
  title: string
  count: number
  icon: IconName
  children: ReactNode
}) {
  return (
    <section className="surface overflow-hidden rounded-panel border border-line">
      <header className="flex items-center gap-3 border-b border-line bg-[var(--surface-sunken)] px-4 py-3.5 sm:px-5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-icon-tile text-icon-glyph">
          <Icon name={icon} size={16} />
        </span>
        <h2 className="min-w-0 flex-1 text-[15px]">{title}</h2>
        <span className="font-mono text-[12px] text-faint">{count}</span>
      </header>
      {children}
    </section>
  )
}
