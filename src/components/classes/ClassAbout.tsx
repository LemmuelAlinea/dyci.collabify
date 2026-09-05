import { useEffect, useState } from 'react'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { resourceUrl } from '../../lib/api/resources'
import { supabase } from '../../lib/supabase'
import { authErrorMessage } from '../../lib/authError'
import { SEMESTERS, YEAR_LEVELS, fullName } from '../../lib/types'
import type { ClassSummary, Profile, TeachingResource } from '../../lib/types'

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 py-3">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="text-[14px] text-ink">{value}</dd>
    </div>
  )
}

export function ClassAbout({ cls }: { cls: ClassSummary }) {
  const { show } = useToast()
  const [attached, setAttached] = useState<TeachingResource[]>([])
  const [professor, setProfessor] = useState<Profile | null>(null)

  useEffect(() => {
    const ids = [cls.syllabus_id, cls.curriculum_id].filter(Boolean) as string[]
    if (ids.length === 0) {
      setAttached([])
      return
    }
    void supabase
      .from('teaching_resources')
      .select('*')
      .in('id', ids)
      .then(({ data }) => setAttached((data ?? []) as TeachingResource[]))
  }, [cls.syllabus_id, cls.curriculum_id])

  useEffect(() => {
    void supabase
      .from('profiles')
      .select('*')
      .eq('id', cls.professor_id)
      .maybeSingle()
      .then(({ data }) => setProfessor((data as Profile | null) ?? null))
  }, [cls.professor_id])

  async function open(resource: TeachingResource) {
    try {
      window.open(await resourceUrl(resource.file_path), '_blank', 'noopener')
    } catch (err) {
      show(authErrorMessage(err, 'Could not open that file.'), 'error')
    }
  }

  const yearLabel = YEAR_LEVELS.find((y) => y.value === cls.year_level)?.label ?? cls.year_level
  const semLabel = SEMESTERS.find((s) => s.value === cls.semester)?.label ?? cls.semester

  return (
    <div className="space-y-5">
      {cls.description && (
        <section className="card p-4 sm:p-6 shadow-card">
          <h2>About this class</h2>
          <p className="mt-2.5 text-[14px] leading-relaxed whitespace-pre-wrap text-muted">
            {cls.description}
          </p>
        </section>
      )}

      <section className="card p-4 sm:p-6 shadow-card">
        <h2>Details</h2>
        <dl className="mt-2 divide-y divide-[var(--line)]">
          <Row label="Section" value={cls.section} />
          <Row label="Year level" value={yearLabel} />
          <Row label="Semester" value={semLabel} />
          <Row label="School year" value={cls.school_year.replace('-', '–')} />
          <Row label="Professor" value={professor ? fullName(professor) : '—'} />
          <Row
            label="Joining"
            value={cls.join_open ? 'Open to new students' : 'Closed'}
          />
        </dl>
      </section>

      {attached.length > 0 && (
        <section className="card p-4 sm:p-6 shadow-card">
          <h2>Course documents</h2>
          <div className="mt-3 space-y-2">
            {attached.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => open(r)}
                className="flex w-full items-center gap-3 rounded-xl border border-line px-4 py-3 text-left transition-colors hover:bg-[var(--surface-sunken)]"
              >
                <Icon name="file" size={18} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">
                    {r.title}
                  </span>
                  <span className="block text-[12px] text-faint capitalize">{r.kind}</span>
                </span>
                <Icon name="arrowRight" size={16} className="shrink-0 text-faint" />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
