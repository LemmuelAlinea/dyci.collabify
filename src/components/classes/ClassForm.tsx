import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
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

  useEffect(() => {
    if (!initialTouched) setInitial(suggestInitial(name))
  }, [name, initialTouched])

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

  const asOptions = (rows: TeachingResource[]) =>
    rows.map((r) => ({ value: r.id, label: r.title }))

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
        <Field label="Section">
          {(id) => (
            <Input
              id={id}
              required
              value={section}
              onChange={(e) => setSection(e.target.value)}
              placeholder="BSIT-4A"
            />
          )}
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
              options={asOptions(syllabi)}
              placeholder={syllabi.length ? 'No syllabus' : 'Upload one in Syllabi first'}
              disabled={syllabi.length === 0}
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
              options={asOptions(curricula)}
              placeholder={curricula.length ? 'No curriculum' : 'Upload one in Curriculum first'}
              disabled={curricula.length === 0}
            />
          )}
        </Field>
      </div>
    </form>
  )
}
