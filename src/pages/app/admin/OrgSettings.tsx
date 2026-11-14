import { useCallback, useEffect, useState } from 'react'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Field, Input } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Icon'
import { Select } from '../../../components/ui/Select'
import { useToast } from '../../../components/ui/Toast'
import {
  getOrganizationSettings,
  setOrganizationSettings,
  trashPurgePreview,
  type OrgSettings,
} from '../../../lib/api/orgSettings'
import { setOrgSettingsCache } from '../../../hooks/useOrgSettings'
import { authErrorMessage } from '../../../lib/authError'

/** The same bounds the database enforces; it stays the final judge. */
const QUIET = [3, 90] as const
const TRASH = [7, 365] as const
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

function wholeNumber(text: string, [min, max]: readonly [number, number]) {
  const n = Number(text)
  if (text.trim() === '' || !Number.isInteger(n) || n < min || n > max) {
    return { value: null, error: `Enter a whole number of days from ${min} to ${max}.` }
  }
  return { value: n, error: null }
}

function domainCheck(text: string) {
  const d = text.trim().toLowerCase()
  if (d.length < 4 || d.length > 253 || !DOMAIN_RE.test(d)) {
    return { value: null, error: 'Enter a domain like dyci.edu.ph, with no @ and no spaces.' }
  }
  return { value: d, error: null }
}

/**
 * The four settings the admin owns for the whole organization. The database holds the row and
 * checks every value again; this page saves only what changed, so two admins editing different
 * values never overwrite each other.
 */
export default function OrgSettings() {
  const { show } = useToast()
  const [saved, setSaved] = useState<OrgSettings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [quiet, setQuiet] = useState('')
  const [trash, setTrash] = useState('')
  const [visibility, setVisibility] = useState<OrgSettings['new_project_visibility']>('private')
  const [domain, setDomain] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [purge, setPurge] = useState<{ days: number; count: number | null } | null>(null)

  const fill = useCallback((s: OrgSettings) => {
    setSaved(s)
    setQuiet(String(s.quiet_days))
    setTrash(String(s.trash_retention_days))
    setVisibility(s.new_project_visibility)
    setDomain(s.school_email_domain)
  }, [])

  const load = useCallback(async () => {
    try {
      fill(await getOrganizationSettings())
      setLoadError(null)
    } catch (err) {
      setLoadError(authErrorMessage(err, 'Could not load the organization settings.'))
    }
  }, [fill])

  useEffect(() => {
    document.title = 'Settings · Collabify'
    void load()
  }, [load])

  const q = wholeNumber(quiet, QUIET)
  const t = wholeNumber(trash, TRASH)
  const d = domainCheck(domain)

  const lowered = saved && t.value !== null && t.value < saved.trash_retention_days ? t.value : null
  useEffect(() => {
    setPurge(null)
    if (lowered === null) return
    let live = true
    const timer = setTimeout(() => {
      trashPurgePreview(lowered)
        .then((n) => live && setPurge({ days: lowered, count: n }))
        .catch(() => live && setPurge({ days: lowered, count: null }))
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [lowered])

  if (!saved) {
    return (
      <div className="space-y-6">
        <DirectoryHero title="Organization" accent="settings." />
        {loadError ? (
          <Alert tone="error" onRetry={load}>{loadError}</Alert>
        ) : (
          <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Loading the settings…
          </div>
        )}
      </div>
    )
  }

  const changes: Partial<OrgSettings> = {}
  if (q.value !== null && q.value !== saved.quiet_days) changes.quiet_days = q.value
  if (t.value !== null && t.value !== saved.trash_retention_days) changes.trash_retention_days = t.value
  if (visibility !== saved.new_project_visibility) changes.new_project_visibility = visibility
  if (d.value !== null && d.value !== saved.school_email_domain) changes.school_email_domain = d.value
  const invalid = Boolean(q.error || t.error || d.error)
  const canSave = !invalid && Object.keys(changes).length > 0

  async function save() {
    setSaving(true)
    setSaveError(null)
    try {
      const next = await setOrganizationSettings(changes)
      setOrgSettingsCache(next)
      fill(next)
      show('Settings saved')
    } catch (err) {
      setSaveError(authErrorMessage(err, 'Could not save the settings.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <DirectoryHero
        title="Organization"
        accent="settings."
        description="Four values that apply to everyone. Nothing changes until you save."
      />

      <section className="surface rounded-panel border border-line p-5 sm:p-6">
        <div className="grid max-w-3xl gap-6 sm:grid-cols-2">
          <Field label="Quiet after (days)" error={q.error}>
            {(id) => (
              <>
                <Input id={id} type="number" inputMode="numeric" min={QUIET[0]} max={QUIET[1]} value={quiet} onChange={(e) => setQuiet(e.target.value)} />
                <p className="text-[12px] text-muted">
                  Days without activity before a project is flagged as quiet. 3 to 90.
                </p>
              </>
            )}
          </Field>

          <Field label="Trash keeps items for (days)" error={t.error}>
            {(id) => (
              <>
                <Input id={id} type="number" inputMode="numeric" min={TRASH[0]} max={TRASH[1]} value={trash} onChange={(e) => setTrash(e.target.value)} />
                <p className="text-[12px] text-muted">
                  How long trashed items wait before the nightly clean-up deletes them. 7 to 365.
                </p>
                {purge !== null && purge.days === lowered && (
                  purge.count === null ? (
                    <p className="text-[12px] text-muted">
                      Could not count the trash that would be deleted. Saving still works.
                    </p>
                  ) : (
                    <p className="text-[12px] text-warning-700 dark:text-warning-300">
                      {`Up to ${purge.count} trashed ${purge.count === 1 ? 'item' : 'items'} could be deleted at the next nightly clean-up.`}
                    </p>
                  )
                )}
              </>
            )}
          </Field>

          <Field label="New projects start">
            {(id) => (
              <>
                <Select
                  id={id}
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as OrgSettings['new_project_visibility'])}
                  options={[
                    { value: 'private', label: 'Private' },
                    { value: 'workspace', label: 'Workspace' },
                  ]}
                />
                <p className="text-[12px] text-muted">
                  Who can read a new work project. Class files projects always start Private.
                </p>
              </>
            )}
          </Field>

          <Field label="School email domain" error={d.error}>
            {(id) => (
              <>
                <div className="flex items-center gap-2">
                  <span aria-hidden className="font-mono text-[14px] text-muted">@</span>
                  <div className="flex-1">
                    <Input id={id} value={domain} onChange={(e) => setDomain(e.target.value)} autoCapitalize="none" spellCheck={false} />
                  </div>
                </div>
                <p className="text-[12px] text-muted">
                  The email domain accounts must use when the admin imports them.
                </p>
              </>
            )}
          </Field>
        </div>

        {saveError && (
          <div className="mt-5 max-w-3xl">
            <Alert tone="error">{saveError}</Alert>
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <Button className="!rounded-xl" loading={saving} disabled={!canSave} onClick={save}>
            Save settings
          </Button>
          <Button variant="ghost" disabled={saving || !canSave} onClick={() => fill(saved)}>
            Discard changes
          </Button>
        </div>
      </section>
    </div>
  )
}
