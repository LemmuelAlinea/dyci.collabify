import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { Field, Input } from '../../../components/ui/Field'
import { Alert } from '../../../components/ui/Alert'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { Modal } from '../../../components/ui/Modal'
import { Select } from '../../../components/ui/Select'
import { EmptyState } from '../../../components/ui/EmptyState'
import { useToast } from '../../../components/ui/Toast'
import { listAccounts } from '../../../lib/api/accounts'
import { programClasses } from '../../../lib/api/admin'
import {
  createSection,
  deleteSection,
  listSectionOverview,
  updateSection,
} from '../../../lib/api/program'
import { authErrorMessage } from '../../../lib/authError'
import { currentSchoolYear, sectionKey } from '../../../lib/program'
import type { ProgramClass, SectionOverview } from '../../../lib/program'
import { YEAR_LEVELS, fullName } from '../../../lib/types'
import type { Account, YearLevel } from '../../../lib/types'

/**
 * The cohorts the program actually runs.
 *
 * A class writes its section as free text, so BSIT 3A, BSIT-3A and bsit 3a were
 * three cohorts wearing one name. The chair keeps the list here and the class
 * form offers it, which is what makes every figure keyed on a section mean one
 * thing.
 *
 * Nothing is forced. A class already written with a section outside the list
 * keeps working and is shown below as unregistered, so the chair can add the
 * name rather than chase the professor who typed it.
 */
export default function Sections() {
  const { show } = useToast()
  const [rows, setRows] = useState<SectionOverview[] | null>(null)
  const [classes, setClasses] = useState<ProgramClass[]>([])
  const [advisers, setAdvisers] = useState<Account[]>([])
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [level, setLevel] = useState<YearLevel>('1st')
  const [year, setYear] = useState('')
  const [adviser, setAdviser] = useState('')
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<SectionOverview | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    try {
      const [sections, cls, people] = await Promise.all([
        listSectionOverview(),
        programClasses(),
        listAccounts(),
      ])
      setRows(sections)
      setClasses(cls)
      setAdvisers(people.filter((a) => a.role === 'professor' && a.status === 'active'))
      setYear((y) => y || currentSchoolYear(cls))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the sections.'))
      setRows([])
    }
  }, [])

  useEffect(() => {
    document.title = 'Sections · Collabify'
    void load()
  }, [load])

  useLive(load, ['program_sections', 'classes', 'profiles'])

  /**
   * Sections that classes are using but the registry has never heard of. This
   * is the list that actually gets the registry adopted — it names the spelling
   * already in use rather than asking the chair to guess it.
   */
  const unregistered = useMemo(() => {
    const known = new Set((rows ?? []).map((r) => `${sectionKey(r.name)}|${r.school_year}`))
    const seen = new Map<string, { name: string; school_year: string; classes: number }>()
    for (const c of classes) {
      const key = `${sectionKey(c.section)}|${c.school_year}`
      if (known.has(key)) continue
      const at = seen.get(key) ?? { name: c.section, school_year: c.school_year, classes: 0 }
      at.classes += 1
      seen.set(key, at)
    }
    return [...seen.values()]
  }, [rows, classes])

  if (rows === null) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading the sections…
      </div>
    )
  }

  async function add(fromName = name, fromYear = year, fromLevel = level) {
    setSaving(true)
    try {
      await createSection({
        name: fromName,
        year_level: fromLevel,
        school_year: fromYear,
        adviser_id: adviser || null,
      })
      setName('')
      setAdviser('')
      setAdding(false)
      show('Section added')
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not add that section.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <DirectoryHero
        title="Every cohort,"
        accent="one clear name."
        description="Keep section names, year levels, advisers, and enrolment figures consistent across the program."
        action={
          <Button variant="onNavy" size="sm" className="!rounded-lg" onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} />
            Add a section
          </Button>
        }
        statsVariant="compact-row"
        stats={[
          { value: rows.length, label: 'Sections' },
          { value: rows.filter((section) => !section.archived_at).length, label: 'Active' },
          { value: rows.reduce((sum, section) => sum + section.classes, 0), label: 'Classes' },
          { value: rows.reduce((sum, section) => sum + section.students, 0), label: 'Students' },
        ]}
      />

      {error && <Alert tone="error" onRetry={load}>{error}</Alert>}

      {/* A dialog, not a panel. Sections are added at the start of a term and
          then left alone, so the form was five controls sitting above the list
          for the rest of the year. */}
      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a section"
        description="Professors pick from this list when they make a class."
        size="md"
        focusField
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              className="!rounded-xl"
              loading={saving}
              disabled={!name.trim() || !year.trim()}
              onClick={() => add()}
            >
              <Icon name="plus" size={15} />
              Add
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Section name">
            {(id) => (
              <Input
                id={id}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="BSIT 3A"
              />
            )}
          </Field>
          <Field label="Year level">
            {(id) => (
              <Select
                id={id}
                value={level}
                onChange={(e) => setLevel(e.target.value as YearLevel)}
                options={YEAR_LEVELS}
              />
            )}
          </Field>
          <Field label="School year">
            {(id) => (
              <Input
                id={id}
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="2026-2027"
              />
            )}
          </Field>
          <Field label="Adviser">
            {(id) => (
              <Select
                id={id}
                value={adviser}
                onChange={(e) => setAdviser(e.target.value)}
                placeholder="Nobody yet"
                options={advisers.map((a) => ({ value: a.id, label: fullName(a) }))}
              />
            )}
          </Field>
        </div>
      </Modal>

      {unregistered.length > 0 && (
        <section className="surface rounded-panel border border-line p-4 sm:p-5">
          <h2 className="text-ink">Already in use, not on the list</h2>
          <p className="mt-1 max-w-[70ch] text-[13px] text-muted">
            Classes are running under these names. Adding one adopts the spelling that is
            already out there rather than creating a second version of it.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {unregistered.map((u) => (
              <li key={`${u.name}-${u.school_year}`}>
                <button
                  type="button"
                  aria-label={`Add ${u.name} for ${u.school_year}`}
                  onClick={() => {
                    setName(u.name)
                    setYear(u.school_year)
                    setAdding(true)
                  }}
                  className="surface flex items-center gap-2 rounded-xl border border-line px-3 py-1.5 text-[13px] text-ink transition-colors hover:border-line-strong"
                >
                  {u.name}
                  <span className="font-mono text-[12px] text-faint">
                    {u.school_year} · {u.classes}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon="folder"
          title="No sections yet"
          body="Add the cohorts this program runs and professors will pick from them."
        />
      ) : (
        <section className="surface overflow-hidden rounded-panel border border-line">
          <header className="border-b border-line bg-[var(--surface-sunken)] px-4 py-4 sm:px-5">
            <p className="text-[12px] font-medium text-faint">Section registry</p>
            <h2 className="mt-1">Current sections</h2>
          </header>
          <ul className="space-y-2 p-4 sm:p-5">
          {rows.map((s) => (
            <li
              key={s.section_id}
              className={`surface flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 ${
                s.archived_at ? 'border-line opacity-70' : 'border-line'
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] text-ink">
                  {s.name}
                  {s.archived_at && (
                    <span className="ml-2 font-mono text-[12px] text-faint">retired</span>
                  )}
                </span>
                <span className="block text-[12px] text-muted">
                  {s.year_level} year · {s.school_year}
                  {s.adviser_name ? ` · adviser ${s.adviser_name}` : ' · no adviser'}
                </span>
              </span>

              <span className="shrink-0 font-mono text-[12px] text-faint">
                {s.classes} {s.classes === 1 ? 'class' : 'classes'} · {s.students} students
              </span>

              <Button
                size="sm"
                variant="ghost"
                className="!rounded-xl"
                onClick={async () => {
                  try {
                    await updateSection(s.section_id, {
                      archived_at: s.archived_at ? null : new Date().toISOString(),
                    })
                    await load()
                  } catch (err) {
                    show(authErrorMessage(err, 'Could not change that.'), 'error')
                  }
                }}
              >
                {s.archived_at ? 'Bring back' : 'Retire'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="!rounded-xl"
                onClick={() => setRemoving(s)}
              >
                <Icon name="trash" size={14} />
              </Button>
            </li>
          ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={removing !== null}
        title={`Delete ${removing?.name ?? 'this section'}?`}
        body={
          (removing?.classes ?? 0) > 0
            ? `${removing?.classes} class${removing?.classes === 1 ? '' : 'es'} still name this section. They keep running and keep the name — the list simply stops offering it. Retiring it says the same thing and can be undone.`
            : 'Nothing is using it. Retiring it instead keeps the name for next year.'
        }
        confirmLabel="Delete it"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          await deleteSection(removing.section_id)
          show('Section deleted')
          await load()
        }}
      />
    </div>
  )
}
