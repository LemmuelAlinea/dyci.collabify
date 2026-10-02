import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { ActionMenu } from '../../../components/ui/ActionMenu'
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
import { listProfessorAccounts, programClasses } from '../../../lib/api/admin'
import {
  createSection,
  listSectionFaculty,
  listSectionOverview,
  setSectionFaculty,
  updateSection,
} from '../../../lib/api/program'
import { authErrorMessage } from '../../../lib/authError'
import { currentSchoolYear, sectionKey } from '../../../lib/program'
import type { ProgramClass, SectionFaculty, SectionOverview } from '../../../lib/program'
import { YEAR_LEVELS, fullName } from '../../../lib/types'
import type { Account, ProfessorAccount, YearLevel } from '../../../lib/types'

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
 *
 * Each section is assigned to the teaching faculty who run it, several to one
 * section if need be, and a teacher's class form offers only theirs. A section
 * no longer in use is archived, and waits on the Archive page to be restored
 * or deleted for good.
 */
export default function Sections() {
  const { show } = useToast()
  const [rows, setRows] = useState<SectionOverview[] | null>(null)
  const [classes, setClasses] = useState<ProgramClass[]>([])
  const [advisers, setAdvisers] = useState<Account[]>([])
  const [teachers, setTeachers] = useState<ProfessorAccount[]>([])
  const [assigned, setAssigned] = useState<SectionFaculty[]>([])
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [level, setLevel] = useState<YearLevel>('1st')
  const [year, setYear] = useState('')
  const [adviser, setAdviser] = useState('')
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState<SectionOverview | null>(null)
  const [assigning, setAssigning] = useState<SectionOverview | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<SectionOverview | null>(null)

  const load = useCallback(async () => {
    try {
      const [sections, cls, people, faculty, links] = await Promise.all([
        listSectionOverview(),
        programClasses(),
        listAccounts(),
        listProfessorAccounts(),
        listSectionFaculty(),
      ])
      setRows(sections)
      setClasses(cls)
      setAdvisers(people.filter((a) => a.role === 'faculty' && a.status === 'active'))
      setTeachers(faculty.filter((f) => f.status === 'active' && f.can_teach))
      setAssigned(links)
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

  useLive(load, ['program_sections', 'program_section_faculty', 'classes', 'profiles'])

  /**
   * Sections that classes are using but the registry has never heard of. This
   * is the list that actually gets the registry adopted — it names the spelling
   * already in use rather than asking the chair to guess it. Archived sections
   * still count as known, so their name is not offered twice.
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

  /** Archived sections live on the Archive page, not here. */
  const live = useMemo(() => (rows ?? []).filter((r) => !r.archived_at), [rows])

  /** Assigned faculty per section, by name. Anybody who can no longer teach is left out. */
  const facultyOf = useMemo(() => {
    const byId = new Map(teachers.map((t) => [t.id, t]))
    const out = new Map<string, ProfessorAccount[]>()
    for (const link of assigned) {
      const who = byId.get(link.faculty_id)
      if (!who) continue
      out.set(link.section_id, [...(out.get(link.section_id) ?? []), who])
    }
    for (const list of out.values()) list.sort((a, b) => fullName(a).localeCompare(fullName(b)))
    return out
  }, [assigned, teachers])

  if (rows === null) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading the sections…
      </div>
    )
  }

  function openEdit(s: SectionOverview) {
    setName(s.name)
    setLevel(s.year_level)
    setYear(s.school_year)
    setAdviser(s.adviser_id ?? '')
    setEditing(s)
  }

  /** Closing an edit clears its values, so Add starts blank again. */
  function closeDialog() {
    if (saving) return
    setAdding(false)
    if (editing) {
      setEditing(null)
      setName('')
      setLevel('1st')
      setYear(currentSchoolYear(classes))
      setAdviser('')
    }
  }

  async function saveEdit(section: SectionOverview) {
    setSaving(true)
    try {
      await updateSection(section.section_id, {
        name: name.trim(),
        year_level: level,
        school_year: year.trim(),
        adviser_id: adviser || null,
      })
      show(`${name.trim()} updated`)
      setEditing(null)
      setName('')
      setLevel('1st')
      setYear(currentSchoolYear(classes))
      setAdviser('')
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not save that section.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  // Classes match a section by name and school year, so changing either leaves
  // the classes already under it behind.
  const renamed =
    editing !== null &&
    (sectionKey(name) !== sectionKey(editing.name) || year.trim() !== editing.school_year)

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
          <Button variant="create" size="sm" className="!rounded-lg" onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} />
            Add a section
          </Button>
        }
      />

      {error && <Alert tone="error" onRetry={load}>{error}</Alert>}

      {/* A dialog, not a panel. Sections are added at the start of a term and
          then left alone, so the form was five controls sitting above the list
          for the rest of the year. */}
      <Modal
        open={adding || editing !== null}
        onClose={closeDialog}
        title={editing ? `Edit ${editing.name}` : 'Add a section'}
        description={
          editing
            ? 'Its faculty assignments stay as they are.'
            : 'Professors pick from this list when they make a class.'
        }
        size="md"
        focusField
        footer={
          <>
            <Button variant="ghost" onClick={closeDialog} disabled={saving}>
              Cancel
            </Button>
            {editing ? (
              <Button
                className="!rounded-xl"
                loading={saving}
                disabled={!name.trim() || !year.trim()}
                onClick={() => saveEdit(editing)}
              >
                Save changes
              </Button>
            ) : (
              <Button
                className="!rounded-xl"
                loading={saving}
                disabled={!name.trim() || !year.trim()}
                onClick={() => add()}
              >
                <Icon name="plus" size={15} />
                Add
              </Button>
            )}
          </>
        }
      >
        {renamed && (editing?.classes ?? 0) > 0 && (
          <div className="mb-4">
            <Alert tone="info">
              {editing?.classes} {editing?.classes === 1 ? 'class uses' : 'classes use'}{' '}
              {editing?.name} for {editing?.school_year}. They keep that name and show under
              "Already in use" until their professor picks this section again.
            </Alert>
          </div>
        )}
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

      {live.length === 0 ? (
        <EmptyState
          icon="folder"
          title="No sections yet"
          body="Add the cohorts this program runs, then assign each to the faculty who teach it."
        />
      ) : (
        <section className="surface overflow-hidden rounded-panel border border-line">
          <header className="border-b border-line bg-[var(--surface-sunken)] px-4 py-4 sm:px-5">
            <p className="text-[12px] font-medium text-faint">Section registry</p>
            <h2 className="mt-1">Current sections</h2>
          </header>
          <ul className="space-y-2 p-4 sm:p-5">
            {live.map((s) => {
              const faculty = facultyOf.get(s.section_id) ?? []
              return (
                <li
                  key={s.section_id}
                  className="surface flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line px-4 py-3"
                >
                  <span className="min-w-0 flex-1 basis-[240px]">
                    <span className="block text-[14px] text-ink">{s.name}</span>
                    <span className="block text-[12px] text-muted">
                      {s.year_level} year · {s.school_year}
                      {s.adviser_name ? ` · adviser ${s.adviser_name}` : ' · no adviser'}
                    </span>
                    <span className="mt-1 block text-[12px] text-muted">
                      {faculty.length > 0 ? (
                        <>
                          <span className="text-faint">Faculty: </span>
                          {faculty.map((f) => fullName(f)).join(', ')}
                        </>
                      ) : (
                        <span className="text-faint">No faculty assigned</span>
                      )}
                    </span>
                  </span>

                  <span className="shrink-0 font-mono text-[12px] text-faint">
                    {s.classes} {s.classes === 1 ? 'class' : 'classes'} · {s.students} students
                  </span>

                  <span className="flex shrink-0 items-center">
                    <ActionMenu
                      label={`Actions for ${s.name}`}
                      items={[
                        { label: 'Assign faculty', icon: 'users', onSelect: () => setAssigning(s) },
                        { label: 'Edit section', icon: 'edit', onSelect: () => openEdit(s) },
                        { label: 'Archive', icon: 'archive', separated: true, onSelect: () => setArchiving(s) },
                      ]}
                    />
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <AssignFacultyDialog
        section={assigning}
        teachers={teachers}
        current={assigning ? (facultyOf.get(assigning.section_id) ?? []).map((f) => f.id) : []}
        onClose={() => setAssigning(null)}
        onSaved={load}
      />

      <ConfirmDialog
        open={archiving !== null}
        title={`Archive ${archiving?.name ?? 'this section'}?`}
        body={
          (archiving?.classes ?? 0) > 0
            ? `${archiving?.classes} class${archiving?.classes === 1 ? '' : 'es'} still name this section. They keep running and keep the name; professors simply stop being offered it. Restore it from Archive any time.`
            : 'Professors stop being offered it. Restore it from Archive any time, or delete it for good there.'
        }
        confirmLabel="Archive section"
        tone="primary"
        onClose={() => setArchiving(null)}
        onConfirm={async () => {
          if (!archiving) return
          await updateSection(archiving.section_id, { archived_at: new Date().toISOString() })
          show(`${archiving.name} archived`)
          await load()
        }}
      />
    </div>
  )
}

/**
 * Which teaching faculty a section belongs to. Ticking is local until Save,
 * which replaces the section's whole list in one call.
 */
function AssignFacultyDialog({
  section,
  teachers,
  current,
  onClose,
  onSaved,
}: {
  section: SectionOverview | null
  teachers: ProfessorAccount[]
  current: string[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { show } = useToast()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sectionId = section?.section_id
  const currentKey = current.join(',')

  // Fresh each time it opens, from what the section holds now.
  useEffect(() => {
    if (!sectionId) return
    setPicked(new Set(currentKey ? currentKey.split(',') : []))
    setQuery('')
    setError(null)
  }, [sectionId, currentKey])

  const sorted = useMemo(
    () => [...teachers].sort((a, b) => fullName(a).localeCompare(fullName(b))),
    [teachers],
  )
  const q = query.trim().toLowerCase()
  const shown = q
    ? sorted.filter((t) => `${fullName(t)} ${t.email}`.toLowerCase().includes(q))
    : sorted

  function toggle(id: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function save() {
    if (!section) return
    setBusy(true)
    setError(null)
    try {
      await setSectionFaculty(section.section_id, [...picked])
      show(
        picked.size === 0
          ? `${section.name} has no faculty assigned`
          : `${section.name} assigned to ${picked.size} ${picked.size === 1 ? 'teacher' : 'teachers'}`,
      )
      await onSaved()
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the assignments.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={section !== null}
      onClose={() => {
        if (!busy) onClose()
      }}
      title={`Assign ${section?.name ?? 'section'}`}
      description="Faculty who teach pick only their assigned sections when they create a class."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button className="!rounded-xl" loading={busy} onClick={save} disabled={teachers.length === 0}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        {teachers.length === 0 ? (
          <p className="text-[13px] text-muted">
            No faculty can teach yet. Allow teaching for someone in Faculty approvals first.
          </p>
        ) : (
          <>
            {teachers.length > 6 && (
              <Field label="Find faculty">
                {(id) => (
                  <Input
                    id={id}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Name or email"
                  />
                )}
              </Field>
            )}
            <p className="font-mono text-[12px] text-faint">
              {picked.size} of {teachers.length} selected
            </p>
            <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
              {shown.map((t) => (
                <li key={t.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line px-3.5 py-2.5 hover:bg-[var(--surface-sunken)]">
                    <input
                      type="checkbox"
                      checked={picked.has(t.id)}
                      disabled={busy}
                      onChange={(e) => toggle(t.id, e.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] text-ink">{fullName(t)}</span>
                      <span className="block truncate text-[12px] text-muted">{t.email}</span>
                    </span>
                  </label>
                </li>
              ))}
              {shown.length === 0 && (
                <li className="text-[13px] text-muted">Nobody matches that search.</li>
              )}
            </ul>
          </>
        )}
      </div>
    </Modal>
  )
}
