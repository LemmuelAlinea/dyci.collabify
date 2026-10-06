import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { findMyTaskCopy, listLinkOptions } from '../../lib/api/announcements'
import type { LinkOptions } from '../../lib/api/announcements'
import { paths } from '../../lib/paths'
import type { AnnouncementLink } from '../../lib/types'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { Select } from '../ui/Select'

type Kind = AnnouncementLink['kind']

/** The database refuses a ninth. */
export const MAX_LINKS = 8

const KIND: Record<Kind, { label: string; icon: IconName }> = {
  project: { label: 'Project', icon: 'kanban' },
  task: { label: 'Task', icon: 'check' },
  class: { label: 'Class', icon: 'folder' },
}

const same = (a: AnnouncementLink, b: AnnouncementLink) => a.kind === b.kind && a.id === b.id

/**
 * The composer's Links field: what is added so far, then a kind, an item and
 * Add. Options load once per open; an item already added is not offered again.
 */
export function LinkPicker({
  classId,
  professorId,
  value,
  onChange,
  disabled,
}: {
  classId: string
  professorId: string
  value: AnnouncementLink[]
  onChange: (next: AnnouncementLink[]) => void
  disabled?: boolean
}) {
  const [options, setOptions] = useState<LinkOptions | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [kind, setKind] = useState<Kind>('project')
  const [pick, setPick] = useState('')

  useEffect(() => {
    let live = true
    setLoadError(false)
    listLinkOptions(classId, professorId)
      .then((o) => live && setOptions(o))
      .catch(() => {
        if (!live) return
        setOptions({ classes: [], projects: [], tasks: [] })
        setLoadError(true)
      })
    return () => {
      live = false
    }
  }, [classId, professorId])

  const candidates: AnnouncementLink[] = !options
    ? []
    : kind === 'project'
      ? options.projects.map((p) => ({ kind: 'project', id: p.id, label: p.label }))
      : kind === 'task'
        ? options.tasks.map((t) => ({ kind: 'task', id: t.id, project_id: t.project_id, label: t.label }))
        : options.classes.map((c) => ({ kind: 'class', id: c.id, label: c.label }))
  const open = candidates.filter((c) => !value.some((v) => same(v, c)))
  const projectOf = new Map(options?.tasks.map((t) => [t.id, t.project]) ?? [])
  const full = value.length >= MAX_LINKS

  function add() {
    const chosen = open.find((c) => c.id === pick)
    if (!chosen || full) return
    onChange([...value, chosen])
    setPick('')
  }

  const empty =
    kind === 'project'
      ? 'No projects in this class yet'
      : kind === 'task'
        ? 'No tasks you set in this class yet'
        : 'No classes to link'

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="space-y-2">
          {value.map((l) => (
            <li
              key={`${l.kind}-${l.id}`}
              className="flex items-center gap-3 rounded-xl border border-line surface-sunken px-3.5 py-2"
            >
              <Icon name={KIND[l.kind].icon} size={16} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{l.label}</span>
              <span className="shrink-0 font-mono text-[11px] tracking-wider text-faint uppercase">
                {KIND[l.kind].label}
              </span>
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => !same(v, l)))}
                disabled={disabled}
                aria-label={`Remove link to ${l.label}`}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint hover:text-ink"
              >
                <Icon name="x" size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {full ? (
        <p className="text-[12px] text-faint">That is the most links one announcement can hold.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-[9.5rem_minmax(0,1fr)_auto]">
          <Select
            aria-label="Link to"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as Kind)
              setPick('')
            }}
            disabled={disabled}
            options={(['project', 'task', 'class'] as Kind[]).map((k) => ({ value: k, label: KIND[k].label }))}
          />
          <Select
            aria-label={`Pick a ${KIND[kind].label.toLowerCase()}`}
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            disabled={disabled || !options || open.length === 0}
            placeholder={
              !options
                ? 'Loading…'
                : open.length === 0
                  ? candidates.length > 0
                    ? 'All of them are added'
                    : empty
                  : `Pick a ${KIND[kind].label.toLowerCase()}`
            }
            options={open.map((c) => ({
              value: c.id,
              label: c.kind === 'task' && projectOf.get(c.id) ? `${c.label} — ${projectOf.get(c.id)}` : c.label,
            }))}
          />
          <Button
            type="button"
            variant="outline"
            className="!h-12 !rounded-xl"
            onClick={add}
            disabled={disabled || !pick}
          >
            <Icon name="plus" size={15} />
            Add link
          </Button>
        </div>
      )}
      {loadError && (
        <p className="text-[12px] text-danger-600 dark:text-danger-300">
          Could not load what you can link. Close this and open it again.
        </p>
      )}
    </div>
  )
}

/**
 * The links under an announcement. A class or project is a plain link. A task
 * opens the reader's own group's copy, found when clicked; a teacher, or a
 * student whose group was not given it, lands on the project's Tasks tab.
 */
export function LinkList({ links, teacher }: { links: AnnouncementLink[]; teacher: boolean }) {
  const navigate = useNavigate()
  const [opening, setOpening] = useState<string | null>(null)
  if (links.length === 0) return null

  const chip =
    'inline-flex max-w-full items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[13px] text-ink transition-colors hover:border-line-strong hover:bg-[var(--surface-sunken)]'

  async function openTask(l: Extract<AnnouncementLink, { kind: 'task' }>) {
    const tasksTab = `${paths.classProject(l.project_id)}?tab=work`
    if (teacher) return navigate(tasksTab)
    setOpening(l.id)
    try {
      const copy = await findMyTaskCopy(l.id)
      navigate(copy ? `${paths.classProject(l.project_id)}?task=${copy}` : tasksTab)
    } catch {
      navigate(tasksTab)
    } finally {
      setOpening(null)
    }
  }

  return (
    <ul className="mt-4 flex flex-wrap gap-2" aria-label="Links">
      {links.map((l) => {
        const inner = (
          <>
            <Icon name={KIND[l.kind].icon} size={14} className="shrink-0 text-muted" />
            <span className="truncate">{l.label}</span>
            <Icon name="arrowRight" size={13} className="shrink-0 text-faint" />
          </>
        )
        return (
          <li key={`${l.kind}-${l.id}`} className="max-w-full">
            {l.kind === 'task' ? (
              <button
                type="button"
                className={chip}
                onClick={() => void openTask(l)}
                disabled={opening === l.id}
                aria-label={`Open task ${l.label}`}
              >
                {inner}
              </button>
            ) : (
              <Link
                to={l.kind === 'class' ? paths.class(l.id) : paths.classProject(l.id)}
                className={chip}
                aria-label={`Open ${KIND[l.kind].label.toLowerCase()} ${l.label}`}
              >
                {inner}
              </Link>
            )}
          </li>
        )
      })}
    </ul>
  )
}
