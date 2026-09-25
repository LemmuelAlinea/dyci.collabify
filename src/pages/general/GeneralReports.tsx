import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { ReportBuilder } from '../../components/general/reports/ReportBuilder'
import { ReportDocument } from '../../components/general/reports/ReportDocument'
import { CSV_LABELS, sectionCsv } from '../../components/general/reports/csv'
import type { CsvSection } from '../../components/general/reports/csv'
import { ActionMenu } from '../../components/ui/ActionMenu'
import type { ActionMenuItem } from '../../components/ui/ActionMenu'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Field, Input, Toggle } from '../../components/ui/Field'
import { Icon, Spinner } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { Textarea } from '../../components/ui/Select'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { useGeneralReport } from '../../hooks/useGeneralReport'
import { listSpaceTeams } from '../../lib/api/general'
import {
  createReportTemplate,
  deleteReportTemplate,
  listProjectTeams,
  listReportTemplates,
  updateReportTemplate,
} from '../../lib/api/generalReports'
import type { ReportTemplate } from '../../lib/api/generalReports'
import { listSpaceMembers } from '../../lib/api/spaces'
import { authErrorMessage } from '../../lib/authError'
import { fromSearchParams, parseConfig, presetConfig, toSearchParams } from '../../lib/general/reportConfig'
import type { ReportConfig, ReportPresetId } from '../../lib/general/reportConfig'
import { reportCsvName, slug } from '../../lib/general/reportData'
import { rangeLabel } from '../../lib/general/reportRange'
import { downloadCsv } from '../../lib/report'
import { fullName } from '../../lib/types'

type Option = { id: string; label: string; hint?: string }

/**
 * General workplace reports: a builder on the left and the paper it builds on
 * the right. The URL holds the whole configuration, so the page can be
 * bookmarked, shared and reopened exactly; saved reports store the same thing.
 *
 * Desktop first: the rail is a sticky column beside an A4-wide document. On a
 * tablet it folds into a "Customize" dialog under a summary bar, and on a phone
 * the three actions that matter sit in a bar along the bottom.
 */
export default function GeneralReports() {
  const { spaceId } = useParams<{ spaceId: string }>()
  const { profile } = useAuth()
  const { show } = useToast()
  const { spaces, currentSpace: space } = useGeneralNavigation()
  const [params, setParams] = useSearchParams()
  const config = useMemo(() => fromSearchParams(params), [params])
  const report = useGeneralReport(spaceId, config)
  const [people, setPeople] = useState<Option[]>([])
  const [teams, setTeams] = useState<Option[]>([])
  const [templates, setTemplates] = useState<ReportTemplate[]>([])
  const [active, setActive] = useState<ReportTemplate | null>(null)
  const [saving, setSaving] = useState<{ mode: 'new' | 'rename'; template?: ReportTemplate } | null>(null)
  const [deleting, setDeleting] = useState<ReportTemplate | null>(null)
  const [customizing, setCustomizing] = useState(false)

  useEffect(() => {
    document.title = space ? `Reports · ${space.name} · Collabify` : 'Reports · Collabify'
  }, [space])

  const setConfig = useCallback(
    (next: ReportConfig) => setParams(toSearchParams(next), { replace: true }),
    [setParams],
  )

  const loadTemplates = useCallback(async () => {
    if (!spaceId) return
    try {
      setTemplates(await listReportTemplates(spaceId))
    } catch {
      setTemplates([])
    }
  }, [spaceId])

  useEffect(() => {
    void loadTemplates()
  }, [loadTemplates])

  useEffect(() => {
    if (!spaceId) return
    listSpaceMembers(spaceId).then(
      (rows) => setPeople(rows.map((r) => ({ id: r.user_id, label: `${r.first_name} ${r.last_name}`.trim(), hint: r.level[0].toUpperCase() + r.level.slice(1) }))),
      () => setPeople([]),
    )
  }, [spaceId])

  const chosenIds = useMemo(() => (report.chosen ?? []).map((p) => p.project_id).join(','), [report.chosen])
  useEffect(() => {
    if (!spaceId) return
    const ids = chosenIds ? chosenIds.split(',') : []
    Promise.all([listSpaceTeams(spaceId).catch(() => []), listProjectTeams(ids).catch(() => [])]).then(([spaceTeams, projectTeams]) => {
      const nameOf = (id: string) => report.scope?.find((p) => p.project_id === id)?.name ?? ''
      setTeams([
        ...spaceTeams.map((t) => ({ id: t.id, label: t.name, hint: 'Space team' })),
        ...projectTeams.map((t) => ({ id: t.id, label: t.name, hint: nameOf(t.project_id) })),
      ])
    })
  }, [spaceId, chosenIds, report.scope])

  const isLead = (report.scope ?? []).some((p) => p.is_lead)
  const projects = report.chosen ?? []

  function applyPreset(id: ReportPresetId) {
    const projectId = config.scope === 'project' && config.projectIds !== 'all' ? config.projectIds[0] : projects[0]?.project_id
    const next = presetConfig(id, {
      projectId: id === 'weekly' ? (config.scope === 'project' ? projectId : null) : projectId,
      personId: isLead ? (config.people[0] ?? null) : profile?.id ?? null,
    })
    setActive(null)
    setConfig(next)
  }

  function openTemplate(t: ReportTemplate) {
    setActive(t)
    setConfig(parseConfig(t.config))
  }

  async function templateAction(t: ReportTemplate, action: 'rename' | 'share' | 'duplicate' | 'delete') {
    try {
      if (action === 'rename') setSaving({ mode: 'rename', template: t })
      if (action === 'delete') setDeleting(t)
      if (action === 'share') {
        await updateReportTemplate(t.id, { shared: !t.shared })
        show(t.shared ? `${t.name} is private again` : `${t.name} is shared with the space`)
        await loadTemplates()
      }
      if (action === 'duplicate' && profile && spaceId) {
        await createReportTemplate({ spaceId, ownerId: profile.id, name: `${t.name} (copy)`.slice(0, 80), description: t.description, shared: false, config: parseConfig(t.config) })
        show('Copy saved to your reports')
        await loadTemplates()
      }
    } catch (err) {
      show(authErrorMessage(err, 'That did not go through. Try again.'), 'error')
    }
  }

  async function save() {
    const editable = active && (active.owner_id === profile?.id || space?.my_level === 'owner')
    if (!editable || !active) {
      setSaving({ mode: 'new' })
      return
    }
    try {
      await updateReportTemplate(active.id, { config })
      show(`${active.name} saved`)
      await loadTemplates()
    } catch (err) {
      show(authErrorMessage(err, 'Could not save this report. Try again.'), 'error')
    }
  }

  const subject = config.scope === 'space' ? 'space' : projects[0]?.name ?? 'project'

  function print() {
    const before = document.title
    document.title = `collabify-${slug(space?.name ?? 'space')}-${slug(subject)}-${report.range.from}_${report.range.to}`
    const restore = () => {
      document.title = before
      window.removeEventListener('afterprint', restore)
    }
    window.addEventListener('afterprint', restore)
    window.print()
  }

  const csvItems: ActionMenuItem[] = (Object.keys(CSV_LABELS) as CsvSection[])
    .filter((s) => config.sections[s] && (s !== 'projectComparison' || config.scope === 'space'))
    .map((s) => ({
      label: CSV_LABELS[s],
      icon: 'download' as const,
      onSelect: () => {
        const csv = sectionCsv(s, report.data, projects)
        if (!csv) {
          show(`${CSV_LABELS[s]} has not loaded yet. Try again in a moment.`, 'error')
          return
        }
        downloadCsv(reportCsvName(space?.name ?? 'space', subject, CSV_LABELS[s], report.range.from, report.range.to), csv)
      },
    }))

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      show('Link copied')
    } catch {
      show('Could not copy the link. Copy it from the address bar instead.', 'error')
    }
  }

  if (spaceId && spaces !== null && !space) return <Navigate to="/general/spaces" replace />

  const builder = profile && (
    <ReportBuilder
      config={config}
      onChange={setConfig}
      onPreset={applyPreset}
      scope={report.scope ?? []}
      isLead={isLead}
      people={people}
      teams={teams}
      templates={templates}
      viewerId={profile.id}
      canManageSpace={space?.my_level === 'owner'}
      onOpenTemplate={openTemplate}
      onTemplateAction={(t, a) => void templateAction(t, a)}
      onSave={() => void save()}
      onSaveAs={() => setSaving({ mode: 'new' })}
      activeTemplate={active}
      onPrint={print}
      csvItems={csvItems}
      onCopyLink={() => void copyLink()}
    />
  )

  const document_ =
    report.scopeError ? (
      <Alert tone="error" onRetry={() => void report.reload()}>{report.scopeError}</Alert>
    ) : !report.scope || !profile ? (
      <div className="flex items-center gap-3 py-16 text-[14px] text-muted">
        <Spinner size={16} /> Loading reports…
      </div>
    ) : projects.length === 0 ? (
      <EmptyState icon="chart" title="No projects to report on" body="There are no projects in this space you can read. Archived ones appear when you include archived work." />
    ) : (
      <ReportDocument
        config={config}
        spaceName={space?.name ?? 'Space'}
        projects={projects}
        range={report.range}
        prevRange={report.prevRange}
        data={report.data}
        loading={report.loading}
        errors={report.errors}
        generatedBy={profile ? fullName(profile) : 'Somebody'}
        generatedAt={report.today}
        historySince={report.historySince}
        onRetry={() => void report.reload()}
        onMoreActivity={() => void report.loadMoreActivity()}
        moreLoading={report.moreLoading}
      />
    )

  const enabledCount = Object.values(config.sections).filter(Boolean).length

  return (
    <div className="w-full pb-20 md:pb-0">
      {/* Tablet: a summary of the choices and the way into them. */}
      <div className="mb-4 hidden flex-wrap items-center gap-2 md:flex lg:hidden print:hidden">
        <span className="rounded-full surface-sunken px-3 py-1 text-[12px] text-ink">{config.scope === 'space' ? 'Whole space' : projects[0]?.name ?? 'Project'}</span>
        <span className="rounded-full surface-sunken px-3 py-1 text-[12px] text-ink">{rangeLabel(report.range)}</span>
        <span className="rounded-full surface-sunken px-3 py-1 text-[12px] text-ink">{enabledCount} sections</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={print}><Icon name="file" size={14} /> Print</Button>
          <Button size="sm" onClick={() => setCustomizing(true)}><Icon name="settings" size={14} /> Customize</Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="hidden lg:block print:hidden" aria-label="Report builder">
          <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-card border border-line bg-[var(--surface)] p-4">
            <h1 className="mb-4 font-display text-[20px] leading-7 font-semibold text-ink">Reports</h1>
            {builder}
          </div>
        </aside>

        <div className="min-w-0 rounded-card md:bg-[var(--surface-sunken)] md:p-6 print:!bg-transparent print:!p-0">
          <div className="mx-auto w-full max-w-[794px] print:max-w-none">{document_}</div>
        </div>
      </div>

      {/* Phone: the actions within thumb reach. */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-line bg-[var(--surface)] px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] md:hidden print:hidden">
        <Button size="sm" className="flex-1" onClick={() => setCustomizing(true)}><Icon name="settings" size={14} /> Customize</Button>
        <Button size="sm" variant="outline" className="flex-1" onClick={print}><Icon name="file" size={14} /> Print</Button>
        <ActionMenu
          label="More"
          items={[...csvItems, { label: 'Copy link', icon: 'copy', separated: true, onSelect: () => void copyLink() }]}
        />
      </div>

      <Modal open={customizing} onClose={() => setCustomizing(false)} title="Customize the report" size="md"
        footer={<Button onClick={() => setCustomizing(false)}>Show the report</Button>}>
        {builder}
      </Modal>

      <SaveDialog
        state={saving}
        onClose={() => setSaving(null)}
        onSave={async ({ name, description, shared }) => {
          if (!profile || !spaceId) return
          if (saving?.mode === 'rename' && saving.template) {
            await updateReportTemplate(saving.template.id, { name, description, shared })
            show(`${name} saved`)
          } else {
            const t = await createReportTemplate({ spaceId, ownerId: profile.id, name, description, shared, config })
            setActive(t)
            show(`${name} saved to your reports`)
          }
          await loadTemplates()
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return
          try {
            await deleteReportTemplate(deleting.id)
          } catch (err) {
            throw new Error(authErrorMessage(err, 'Could not delete that saved report.'), { cause: err })
          }
          if (active?.id === deleting.id) setActive(null)
          show(`${deleting.name} deleted`)
          await loadTemplates()
        }}
        title="Delete this saved report?"
        body={`${deleting?.name ?? 'It'} will be gone for you${deleting?.shared ? ' and everyone it is shared with' : ''}. The work it reports on is not touched.`}
        confirmLabel="Delete saved report"
      />
    </div>
  )
}

function SaveDialog({
  state,
  onClose,
  onSave,
}: {
  state: { mode: 'new' | 'rename'; template?: ReportTemplate } | null
  onClose: () => void
  onSave: (v: { name: string; description: string; shared: boolean }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [shared, setShared] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seen, setSeen] = useState<typeof state>(null)

  if (state !== seen) {
    setSeen(state)
    setName(state?.template?.name ?? '')
    setDescription(state?.template?.description ?? '')
    setShared(state?.template?.shared ?? false)
    setError(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSave({ name: name.trim(), description: description.trim(), shared })
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save this report. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={state !== null}
      onClose={onClose}
      title={state?.mode === 'rename' ? 'Rename saved report' : 'Save this report'}
      description="A saved report keeps these choices, not the numbers. Opening it runs it again on the latest work."
      size="sm"
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="save-report" loading={busy} disabled={!name.trim()}>Save</Button>
        </>
      }
    >
      <form id="save-report" onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Name">{(id) => <Input id={id} required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Description" optional>
          {(id) => <Textarea id={id} rows={2} maxLength={280} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[14px] text-ink">
            Share with the space
            <span className="block text-[12px] text-muted">Everyone in the space can open it. Each person still sees only what they may.</span>
          </span>
          <Toggle label="Share with the space" checked={shared} onChange={setShared} />
        </div>
      </form>
    </Modal>
  )
}
