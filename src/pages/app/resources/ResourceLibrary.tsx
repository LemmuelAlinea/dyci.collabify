import { useCallback, useEffect, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
import type { FormEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ActionMenu } from '../../../components/ui/ActionMenu'
import { Button } from '../../../components/ui/Button'
import { Field, Input } from '../../../components/ui/Field'
import { Alert } from '../../../components/ui/Alert'
import { FileDrop, formatBytes } from '../../../components/ui/FileDrop'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { Modal } from '../../../components/ui/Modal'
import { EmptyState } from '../../../components/ui/EmptyState'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../context/AuthContext'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import {
  archiveResource,
  listArchivedResources,
  listProgramResources,
  listResources,
  resourceUrl,
  trashResource,
  uploadResource,
} from '../../../lib/api/resources'
import { authErrorMessage } from '../../../lib/authError'
import { paths } from '../../../lib/paths'
import { PARSE_STATUS_LABEL } from '../../../lib/types'
import type { ResourceKind, TeachingResource } from '../../../lib/types'

type Copy = {
  title: string
  eyebrow: string
  intro: string
  emptyTitle: string
  emptyBody: string
  addLabel: string
  titleLabel: string
  titlePlaceholder: string
}

export function ResourceLibrary({
  kind,
  copy,
  /**
   * The program office's shelf rather than a professor's own. Uploads are
   * published to everybody, and the page lists what has been published rather
   * than what this person owns.
   */
  programWide = false,
  toolbar,
}: {
  kind: ResourceKind
  copy: Copy
  programWide?: boolean
  toolbar?: ReactNode
}) {
  const { profile } = useAuth()
  const { show } = useToast()

  const [items, setItems] = useState<TeachingResource[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [archived, setArchived] = useState<TeachingResource[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [acting, setActing] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // What the program office published. Read-only here: a professor attaches one
  // to a class from the class form, and only the chair can change it.
  const [published, setPublished] = useState<TeachingResource[]>([])

  useEffect(() => {
    if (programWide) return
    void listProgramResources(kind)
      .then(setPublished)
      .catch(() => setPublished([]))
  }, [kind, programWide])

  useEffect(() => {
    document.title = `${copy.title} · Collabify`
  }, [copy.title])

  const load = useCallback(async () => {
    if (!profile) return
    try {
      const [live, gone] = await Promise.all([
        programWide ? listProgramResources(kind) : listResources(profile.id, kind),
        listArchivedResources(kind, programWide ? 'program' : { professorId: profile.id }),
      ])
      setItems(live)
      setArchived(gone)
      setLoadError(null)
    } catch (err) {
      setLoadError(authErrorMessage(err, `Could not load your ${copy.title.toLowerCase()}.`))
      setItems([])
    }
  }, [profile, kind, copy.title, programWide])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['teaching_resources', 'syllabus_weeks'])

  function resetForm() {
    setTitle('')
    setFile(null)
    setFormError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!profile || !file) {
      setFormError('Pick a file to upload.')
      return
    }
    setFormError(null)
    setBusy(true)
    try {
      await uploadResource({ professorId: profile.id, kind, title, file, programWide })
      setAddOpen(false)
      resetForm()
      show(`${copy.titleLabel} uploaded`)
      await load()
    } catch (err) {
      setFormError(authErrorMessage(err, 'Could not upload that file.'))
    } finally {
      setBusy(false)
    }
  }

  /** Archive, restore and Trash all land the same way: a toast, then a fresh list. */
  async function act(r: TeachingResource, action: () => Promise<void>, done: string, failed: string) {
    setActing(r.id)
    try {
      await action()
      show(done)
      await load()
    } catch (err) {
      show(authErrorMessage(err, failed), 'error')
    } finally {
      setActing(null)
    }
  }

  const archiveItem = (r: TeachingResource) =>
    void act(r, () => archiveResource(r.id, true), `${r.title} archived`, 'Could not archive it.')
  const restoreItem = (r: TeachingResource) =>
    void act(r, () => archiveResource(r.id, false), `${r.title} is back in your library`, 'Could not restore it.')
  const trashItem = (r: TeachingResource) =>
    void act(
      r,
      () => trashResource(r.id),
      `${r.title} moved to Trash. It stays there for 30 days.`,
      'Could not move it to Trash.',
    )

  async function open(resource: TeachingResource) {
    try {
      window.open(await resourceUrl(resource.file_path), '_blank', 'noopener')
    } catch (err) {
      show(authErrorMessage(err, 'Could not open that file.'), 'error')
    }
  }

  return (
    <div className="w-full">
      {programWide ? (
        <DirectoryHero
          title="Program"
          accent={`${kind === 'syllabus' ? 'syllabi' : 'curricula'}, shared.`}
          description={copy.intro}
          action={
            <Button variant="onNavy" size="sm" onClick={() => setAddOpen(true)} className="!rounded-lg">
              <Icon name="plus" size={16} />
              {copy.addLabel}
            </Button>
          }
        />
      ) : (
        <DirectoryHero
          title={kind === 'curriculum' ? 'Program' : 'Course'}
          accent={`${copy.title.toLowerCase()}.`}
          description={copy.intro}
          action={
            <Button
              variant="onNavy"
              size="sm"
              onClick={() => setAddOpen(true)}
              className="!rounded-lg"
            >
              <Icon name="plus" size={16} />
              {copy.addLabel}
            </Button>
          }
        />
      )}

      {toolbar && <div className="mt-6">{toolbar}</div>}

      <div className="mt-8">
        {loadError && <Alert tone="error">{loadError}</Alert>}

        {!programWide && (
          <div className="mb-5 border-b border-line pb-4">
            <p className="text-[12px] font-medium text-faint">Document library</p>
            <h2 className="mt-1">Your {copy.title.toLowerCase()}</h2>
          </div>
        )}

        {published.length > 0 && (
          <section className="mb-6 overflow-hidden rounded-panel border border-line surface shadow-card">
            <div className="border-b border-line surface-sunken px-5 py-4">
              <h3>From the program office</h3>
              <p className="mt-1 max-w-[620px] text-[12px] text-muted">
                Shared across the program and ready to attach from class settings.
              </p>
            </div>
            <ul className="divide-y divide-[var(--line)]">
              {published.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3.5"
                >
                  <Icon name="file" size={15} className="shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{r.title}</span>
                  <button
                    type="button"
                    onClick={() => void open(r)}
                    className="shrink-0 text-[12px] font-medium text-navy-600 hover:underline dark:text-navy-200"
                  >
                    Open
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {items === null ? (
          <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Loading…
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="file"
            title={copy.emptyTitle}
            body={copy.emptyBody}
            action={
              <Button onClick={() => setAddOpen(true)} className="!rounded-xl">
                {copy.addLabel}
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {items.map((r) => (
              <li key={r.id} className="surface flex min-h-[96px] items-center gap-4 rounded-card border border-line px-5 py-4 transition-colors hover:border-line-strong">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-icon-tile text-icon-glyph">
                  <Icon name="file" size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-ink">{r.title}</p>
                  <p className="truncate text-[12px] text-faint">
                    {r.file_name} · {formatBytes(r.size_bytes)} ·{' '}
                    {new Date(r.uploaded_at).toLocaleDateString()}
                    {kind === 'syllabus' && (
                      <> · {PARSE_STATUS_LABEL[r.parse_status ?? 'unparsed']}</>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {kind === 'syllabus' && (
                    <Link
                      to={paths.syllabus(r.id)}
                      aria-label={`Week map for ${r.title}`}
                      title="Week map"
                      className="grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
                    >
                      <Icon name="calendar" size={17} />
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => open(r)}
                    aria-label={`Open ${r.title}`}
                    className="grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
                  >
                    <Icon name="eye" size={17} />
                  </button>
                  <ActionMenu
                    label={`Actions for ${r.title}`}
                    disabled={acting === r.id}
                    items={[
                      { label: 'Archive', icon: 'archive', onSelect: () => archiveItem(r) },
                      { label: 'Move to trash', icon: 'trash', tone: 'danger', separated: true, onSelect: () => trashItem(r) },
                    ]}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        {archived.length > 0 && (
          <section className="mt-8 overflow-hidden rounded-panel border border-line surface">
            <button
              type="button"
              onClick={() => setShowArchived(!showArchived)}
              aria-expanded={showArchived}
              className="flex w-full items-center gap-3 border-b border-line bg-[var(--surface-sunken)] px-5 py-3 text-left"
            >
              <Icon name="archive" size={15} className="shrink-0 text-faint" />
              <span className="flex-1">
                <span className="font-medium text-ink">Archived</span>
                <span className="ml-2 text-[12px] text-muted">
                  Out of the library and the class pickers. Classes already using one keep it.
                </span>
              </span>
              <span className="rounded-full surface px-2.5 py-1 font-mono text-[12px] text-muted">{archived.length}</span>
              <Icon name={showArchived ? 'chevronDown' : 'chevronRight'} size={14} className="shrink-0 text-faint" />
            </button>
            {showArchived && (
              <ul className="divide-y divide-[var(--line)]">
                {archived.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3.5">
                    <Icon name="file" size={15} className="shrink-0 text-faint" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] text-ink">{r.title}</p>
                      <p className="truncate text-[12px] text-faint">
                        {r.file_name} · {formatBytes(r.size_bytes)}
                        {r.archived_at ? ` · Archived ${new Date(r.archived_at).toLocaleDateString()}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void open(r)}
                      className="shrink-0 text-[12px] font-medium text-navy-600 hover:underline dark:text-navy-200"
                    >
                      Open
                    </button>
                    <ActionMenu
                      label={`Actions for ${r.title}`}
                      disabled={acting === r.id}
                      items={[
                        { label: 'Restore', icon: 'refresh', onSelect: () => restoreItem(r) },
                        { label: 'Move to trash', icon: 'trash', tone: 'danger', separated: true, onSelect: () => trashItem(r) },
                      ]}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <Modal
        open={addOpen}
        onClose={() => {
          setAddOpen(false)
          resetForm()
        }}
        title={copy.addLabel}
        description="Classes can point at this once it's uploaded."
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setAddOpen(false)
                resetForm()
              }}
            >
              Cancel
            </Button>
            <Button form="resource-form" type="submit" loading={busy} className="!rounded-xl">
              Upload
            </Button>
          </>
        }
      >
        <form id="resource-form" onSubmit={submit} className="space-y-4">
          {formError && <Alert tone="error">{formError}</Alert>}
          <Field label={copy.titleLabel}>
            {(id) => (
              <Input
                id={id}
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={copy.titlePlaceholder}
              />
            )}
          </Field>
          <Field label="File">
            {() => <FileDrop file={file} onPick={setFile} maxSize={10} />}
          </Field>
        </form>
      </Modal>
    </div>
  )
}
