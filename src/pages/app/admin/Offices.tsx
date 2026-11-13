import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLive } from '../../../hooks/useLive'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { EmptyState } from '../../../components/ui/EmptyState'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { useToast } from '../../../components/ui/Toast'
import {
  archiveOffice,
  listOffices,
  listOfficePeople,
  listOfficeSpaces,
} from '../../../lib/api/offices'
import { authErrorMessage } from '../../../lib/authError'
import { liveOfficeId } from '../../../lib/offices'
import type { Office, OfficePerson, OfficeSpace } from '../../../lib/offices'
import { OfficeDetail } from './offices/OfficeDetail'
import { OfficeDialog } from './offices/OfficeDialog'

type Data = { offices: Office[]; people: OfficePerson[]; spaces: OfficeSpace[] }

/** `?office=unassigned` opens the Unassigned entry; Admin Home links to both. */
const UNASSIGNED = 'unassigned'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * The admin's offices, and who and what is filed under each.
 *
 * People and spaces are grouped by their live office, so one still linked to
 * an archived office shows under Unassigned, as the overview on Admin Home
 * counts it. The counts in the list are active people and spaces not archived;
 * the lists themselves name everybody, and say when somebody is not active.
 */
export default function Offices() {
  const { show } = useToast()
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<Office | null>(null)
  const [archiving, setArchiving] = useState<Office | null>(null)

  const fetchAll = useCallback(async () => {
    try {
      const [offices, people, spaces] = await Promise.all([
        listOffices(),
        listOfficePeople(),
        listOfficeSpaces(),
      ])
      setData({ offices, people, spaces })
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the offices. Try again.'))
    }
  }, [])

  const load = useCallback(async () => {
    await fetchAll()
  }, [fetchAll])

  useEffect(() => {
    document.title = 'Offices · Collabify'
    void load()
  }, [load])

  useLive(load, ['offices', 'office_members', 'office_spaces', 'profiles', 'general_spaces'])

  const live = useMemo(
    () =>
      (data?.offices ?? [])
        .filter((o) => o.archived_at === null)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [data],
  )

  /** People and live spaces by live office id, with Unassigned under ''. */
  const filed = useMemo(() => {
    const people = new Map<string, OfficePerson[]>()
    const spaces = new Map<string, OfficeSpace[]>()
    const offices = data?.offices ?? []
    for (const p of data?.people ?? []) {
      const key = liveOfficeId(p.office_id, offices) ?? ''
      people.set(key, [...(people.get(key) ?? []), p])
    }
    for (const s of data?.spaces ?? []) {
      if (s.archived) continue
      const key = liveOfficeId(s.office_id, offices) ?? ''
      spaces.set(key, [...(spaces.get(key) ?? []), s])
    }
    return { people, spaces }
  }, [data])

  const asked = params.get('office')
  const selected: Office | null =
    asked === UNASSIGNED ? null : (live.find((o) => o.id === asked) ?? live[0] ?? null)
  const selectedKey = selected?.id ?? ''

  // A link to an office that is gone or archived drops its id, so the list shows.
  const stale = data !== null && asked !== null && asked !== UNASSIGNED && !live.some((o) => o.id === asked)
  useEffect(() => {
    if (stale) setParams({}, { replace: true })
  }, [stale, setParams])

  function open(key: string) {
    setParams({ office: key || UNASSIGNED })
  }

  async function saved(created: Office | null) {
    await fetchAll()
    if (created) open(created.id)
  }

  const newOffice = (
    <Button variant="create" size="sm" className="!rounded-lg" onClick={() => setAdding(true)}>
      <Icon name="plus" size={15} />
      New office
    </Button>
  )

  const hero = (
    <DirectoryHero
      title="Every office,"
      accent="its people and spaces."
      description="File each member and work space under the office it belongs to, so the overview counts every office on its own."
      action={data && live.length > 0 ? newOffice : undefined}
    />
  )

  const dialogs = (
    <>
      <OfficeDialog
        open={adding || renaming !== null}
        office={renaming}
        onClose={() => {
          setAdding(false)
          setRenaming(null)
        }}
        onSaved={saved}
      />
      <ConfirmDialog
        open={archiving !== null}
        title={`Archive ${archiving?.name ?? 'this office'}?`}
        body="Move its active people and live spaces to another office first. Once archived, it waits on the Archive page to be restored or deleted for good."
        confirmLabel="Archive office"
        tone="primary"
        onClose={() => setArchiving(null)}
        onConfirm={async () => {
          if (!archiving) return
          await archiveOffice(archiving.id)
          show(`${archiving.name} archived`)
          setParams({})
          await load()
        }}
      />
    </>
  )

  if (data === null) {
    return (
      <div className="space-y-6">
        {hero}
        {error ? (
          <Alert tone="error" onRetry={load}>
            {error}
          </Alert>
        ) : (
          <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Loading the offices…
          </div>
        )}
      </div>
    )
  }

  if (live.length === 0) {
    return (
      <div className="space-y-6">
        {hero}
        {error && (
          <Alert tone="error" onRetry={load}>
            {error}
          </Alert>
        )}
        <div data-offices-empty>
          <EmptyState
            icon="briefcase"
            title="No offices yet"
            body="Add the offices your organization runs, then file each member and work space under one."
            action={newOffice}
          />
        </div>
        {dialogs}
      </div>
    )
  }

  const count = (key: string) => ({
    people: (filed.people.get(key) ?? []).filter((p) => p.status === 'active').length,
    spaces: (filed.spaces.get(key) ?? []).length,
  })

  const entries = [
    ...live.map((o) => ({ key: o.id, name: o.name, description: o.description })),
    { key: '', name: 'Unassigned', description: 'Members and work spaces with no office' },
  ]

  return (
    <div className="space-y-6">
      {hero}
      {error && (
        <Alert tone="error" onRetry={load}>
          {error}
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)] lg:items-start">
        {/* On a phone the list and the office are two views; ?office= picks. */}
        <nav
          aria-label="Offices"
          className={`surface overflow-hidden rounded-panel border border-line ${asked ? 'hidden sm:block' : ''}`}
        >
          <header className="border-b border-line bg-[var(--surface-sunken)] px-4 py-3.5">
            <p className="eyebrow text-faint">Organization</p>
            <h2 className="mt-1 text-[17px]">{plural(live.length, 'office', 'offices')}</h2>
          </header>
          <ul className="space-y-1.5 p-2.5">
            {entries.map((e) => {
              const n = count(e.key)
              const current = e.key === selectedKey
              return (
                <li key={e.key || UNASSIGNED} className={e.key ? undefined : 'mt-2 border-t border-line pt-2'}>
                  <button
                    type="button"
                    aria-current={current ? 'page' : undefined}
                    onClick={() => open(e.key)}
                    className={`flex w-full items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                      current
                        ? 'border-line-strong bg-[var(--surface-sunken)]'
                        : 'border-transparent hover:bg-[var(--surface-sunken)]'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span data-office-name className="block truncate text-[14px] text-ink">
                        {e.name}
                      </span>
                      {e.description && (
                        <span className="block truncate text-[12px] text-muted">{e.description}</span>
                      )}
                      <span className="mt-0.5 block font-mono text-[11px] text-faint">
                        {plural(n.people, 'person', 'people')} · {plural(n.spaces, 'space', 'spaces')}
                      </span>
                    </span>
                    <Icon name="chevronRight" size={15} className="mt-1 shrink-0 text-faint lg:hidden" />
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className={asked ? '' : 'hidden sm:block'}>
          <OfficeDetail
            key={selectedKey || UNASSIGNED}
            eyebrow={selected ? 'Office' : 'Not filed'}
            title={selected?.name ?? 'Unassigned'}
            description={
              selected
                ? selected.description
                : 'Members and work spaces with no live office. Move each one to the office it belongs to.'
            }
            actions={
              selected && (
                <>
                  <Button variant="outline" size="sm" className="!rounded-lg" onClick={() => setRenaming(selected)}>
                    <Icon name="edit" size={14} />
                    Rename
                  </Button>
                  <Button variant="outline" size="sm" className="!rounded-lg" onClick={() => setArchiving(selected)}>
                    <Icon name="archive" size={14} />
                    Archive
                  </Button>
                </>
              )
            }
            back={
              <button
                type="button"
                onClick={() => setParams({})}
                className="mb-2 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"
              >
                <Icon name="arrowLeft" size={14} />
                All offices
              </button>
            }
            officeId={selected?.id ?? null}
            people={filed.people.get(selectedKey) ?? []}
            spaces={filed.spaces.get(selectedKey) ?? []}
            offices={live}
            allOffices={data.offices}
            onMoved={load}
          />
        </div>
      </div>

      {dialogs}
    </div>
  )
}
