import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
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
      <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
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
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="eyebrow">Program</p>
          <h1 className="mt-1 text-[26px] leading-tight sm:text-[30px]">Sections</h1>
          <p className="mt-2 max-w-[70ch] text-[14.5px] text-muted">
            The cohorts the program runs this year. A professor making a class picks from
            this list, so one section is spelled one way everywhere and its figures add up.
          </p>
        </div>
        <Button className="!rounded-xl" onClick={() => setAdding(true)}>
          <Icon name="plus" size={15} />
          Add a section
        </Button>
      </header>

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
        <section className="space-y-2">
          <h2 className="text-[15px] text-ink">Already in use, not on the list</h2>
          <p className="max-w-[70ch] text-[13px] text-muted">
            Classes are running under these names. Adding one adopts the spelling that is
            already out there rather than creating a second version of it.
          </p>
          <ul className="flex flex-wrap gap-2">
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
                  className="surface flex items-center gap-2 rounded-xl border border-amber-300 px-3 py-1.5 text-[13px] text-ink transition-colors hover:border-line-strong dark:border-amber-400/40"
                >
                  {u.name}
                  <span className="font-mono text-[11px] text-faint">
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
        <ul className="space-y-2">
          {rows.map((s) => (
            <li
              key={s.section_id}
              className={`surface flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 ${
                s.archived_at ? 'border-line opacity-70' : 'border-line'
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] text-ink">
                  {s.name}
                  {s.archived_at && (
                    <span className="ml-2 font-mono text-[11px] text-faint">retired</span>
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
