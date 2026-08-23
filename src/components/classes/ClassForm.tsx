import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { listSections } from '../../lib/api/program'
import { listProgramResources } from '../../lib/api/resources'
import type { ProgramSection } from '../../lib/program'
import { Alert, Field, Input } from '../ui/Field'
import { Select, Textarea } from '../ui/Select'
import { SCHOOL_YEARS, SEMESTERS, YEAR_LEVELS } from '../../lib/types'
import type { ClassInput } from '../../lib/api/classes'
import type { Semester, TeachingResource, YearLevel } from '../../lib/types'

/** "Database Management" → "DBM". Only a suggestion; the field stays editable. */
export function suggestInitial(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words
    .map((w) => w[0])
    .join('')
    .slice(0, 6)
    .toUpperCase()
}

type Props = {
  formId: string
  defaults?: Partial<ClassInput>
  syllabi: TeachingResource[]
  curricula: TeachingResource[]
  error?: string | null
  onSubmit: (input: ClassInput) => void
}

export function ClassForm({ formId, defaults, syllabi, curricula, error, onSubmit }: Props) {
  const [name, setName] = useState(defaults?.name ?? '')
  const [initial, setInitial] = useState(defaults?.initial ?? '')
  const [initialTouched, setInitialTouched] = useState(Boolean(defaults?.initial))
  const [section, setSection] = useState(defaults?.section ?? '')
  const [yearLevel, setYearLevel] = useState<YearLevel>(defaults?.year_level ?? '4th')
  const [semester, setSemester] = useState<Semester>(defaults?.semester ?? '1st')
  const [schoolYear, setSchoolYear] = useState(defaults?.school_year ?? SCHOOL_YEARS[1].value)
  const [description, setDescription] = useState(defaults?.description ?? '')
  const [syllabusId, setSyllabusId] = useState(defaults?.syllabus_id ?? '')
  const [curriculumId, setCurriculumId] = useState(defaults?.curriculum_id ?? '')
  const [sections, setSections] = useState<ProgramSection[]>([])
  const [published, setPublished] = useState<TeachingResource[]>([])

  // The program office keeps the list of sections. Until it has one, the field
  // stays free text — a professor cannot be blocked from making a class because
  // nobody has filled in a registry yet.
  useEffect(() => {
    void listSections()
      .then(setSections)
      .catch(() => setSections([]))
    // What the program office has published is attachable exactly like a
    // professor's own — the same table, so the same id goes in syllabus_id.
    void Promise.all([listProgramResources('syllabus'), listProgramResources('curriculum')])
      .then(([a, b]) => setPublished([...a, ...b]))
      .catch(() => setPublished([]))
  }, [])

  useEffect(() => {
    if (!initialTouched) setInitial(suggestInitial(name))
  }, [name, initialTouched])

  // Offer the sections of this year level and school year first; a 3rd-year
  // class listing every 1st-year section is how the wrong one gets picked.
  //
  // But never leave the field with nothing in it. A section registered under a
  // different year level than the class being made is a mismatch for the chair
  // to sort out, not a reason a professor cannot create their class — so when
  // the narrow list is empty the whole registry is offered, each one labelled
  // with the year it was filed under.
  const narrow = sections.filter(
    (x) => x.year_level === yearLevel && (!schoolYear || x.school_year === schoolYear),
  )
  const forLevel =
    narrow.length > 0
      ? narrow.map((x) => ({ value: x.name, label: x.name }))
      : sections.map((x) => ({
          value: x.name,
          label: `${x.name} — ${x.year_level} year, ${x.school_year}`,
        }))

  function submit(e: FormEvent) {
    e.preventDefault()
    onSubmit({
      name,
      initial,
      section,
      year_level: yearLevel,
      semester,
      school_year: schoolYear,
      description,
      syllabus_id: syllabusId || null,
      curriculum_id: curriculumId || null,
    })
  }

  const asOptions = (rows: TeachingResource[], kind?: 'syllabus' | 'curriculum') => [
    ...rows.map((r) => ({ value: r.id, label: r.title })),
    ...published
      .filter((r) => (kind ? r.kind === kind : true))
      .filter((r) => !rows.some((own) => own.id === r.id))
      .map((r) => ({ value: r.id, label: `Program · ${r.title}` })),
  ]

  return (
    <form id={formId} onSubmit={submit} className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}

      <Field label="Class name">
        {(id) => (
          <Input
            id={id}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Database Management"
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Class initial"
          hint={<span className="text-[12px] text-faint">2–6 letters</span>}
        >
          {(id) => (
            <Input
              id={id}
              required
              value={initial}
              maxLength={6}
              onChange={(e) => {
                setInitialTouched(true)
                setInitial(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
              }}
              placeholder="DBM"
            />
          )}
        </Field>
        <Field
          label="Section"
          hint={
            sections.length === 0 ? (
              <span className="text-[12px] text-faint">Free text until the program sets its sections</span>
            ) : undefined
          }
        >
          {(id) =>
            sections.length === 0 ? (
              <Input
                id={id}
                required
                value={section}
                onChange={(e) => setSection(e.target.value)}
                placeholder="BSIT-4A"
              />
            ) : (
              <Select
                id={id}
                required
                value={section}
                onChange={(e) => setSection(e.target.value)}
                placeholder="Pick a section"
                options={[
                  ...forLevel,
                  // A class already written under a name the registry never had
                  // must still be editable without silently changing its cohort.
                  ...(section && !sections.some((x) => x.name === section)
                    ? [{ value: section, label: `${section} (not on the list)` }]
                    : []),
                ]}
              />
            )
          }
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Year level">
          {(id) => (
            <Select
              id={id}
              value={yearLevel}
              onChange={(e) => setYearLevel(e.target.value as YearLevel)}
              options={YEAR_LEVELS}
            />
          )}
        </Field>
        <Field label="Semester">
          {(id) => (
            <Select
              id={id}
              value={semester}
              onChange={(e) => setSemester(e.target.value as Semester)}
              options={SEMESTERS}
            />
          )}
        </Field>
      </div>

      <Field label="School year">
        {(id) => (
          <Select
            id={id}
            value={schoolYear}
            onChange={(e) => setSchoolYear(e.target.value)}
            options={SCHOOL_YEARS}
          />
        )}
      </Field>

      <Field label="Description" optional>
        {(id) => (
          <Textarea
            id={id}
            rows={3}
            value={description ?? ''}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this class covers, and anything students should know before joining."
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Syllabus"
          optional
          hint={
            syllabi.length === 0 ? (
              <span className="text-[12px] text-faint">None uploaded</span>
            ) : undefined
          }
        >
          {(id) => (
            <Select
              id={id}
              value={syllabusId ?? ''}
              onChange={(e) => setSyllabusId(e.target.value)}
              options={asOptions(syllabi, 'syllabus')}
              placeholder={
                asOptions(syllabi, 'syllabus').length ? 'No syllabus' : 'Upload one in Syllabi first'
              }
              disabled={asOptions(syllabi, 'syllabus').length === 0}
            />
          )}
        </Field>
        <Field
          label="Curriculum"
          optional
          hint={
            curricula.length === 0 ? (
              <span className="text-[12px] text-faint">None uploaded</span>
            ) : undefined
          }
        >
          {(id) => (
            <Select
              id={id}
              value={curriculumId ?? ''}
              onChange={(e) => setCurriculumId(e.target.value)}
              options={asOptions(curricula, 'curriculum')}
              placeholder={
                asOptions(curricula, 'curriculum').length
                  ? 'No curriculum'
                  : 'Upload one in Curriculum first'
              }
              disabled={asOptions(curricula, 'curriculum').length === 0}
            />
          )}
        </Field>
      </div>
    </form>
  )
}
