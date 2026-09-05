import { useState } from 'react'
import { ResourceLibrary } from '../resources/ResourceLibrary'

/**
 * What the program publishes once, for every section of a course.
 *
 * Two sections of one subject running different outlines is the thing this
 * fixes. A syllabus published here is the same kind of row a professor uploads
 * for themselves — same table, same id — so attaching it to a class, reading it
 * with AI and mapping its weeks all work exactly as they already did.
 *
 * Publishing is the chair's alone, and the database enforces that rather than
 * this page: a trigger refuses `program_wide` from anybody who is not an admin.
 */
export default function ProgramLibrary() {
  const [kind, setKind] = useState<'syllabus' | 'curriculum'>('syllabus')

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Program</p>
        <h1 className="mt-1 leading-tight">Library</h1>
        <p className="mt-2 max-w-[70ch] text-[14px] text-muted">
          Curricula and syllabi published for the whole program. Every professor can attach
          one to their class, so two sections of a subject run the same outline.
        </p>
      </header>

      <div className="flex w-fit rounded-xl surface-sunken p-1">
        {(
          [
            ['syllabus', 'Syllabi'],
            ['curriculum', 'Curricula'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-lg px-3.5 py-1.5 text-[13px] transition-colors ${
              kind === k ? 'surface font-medium text-ink ring-1 ring-[var(--line-strong)]' : 'text-muted hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {kind === 'syllabus' ? (
        <ResourceLibrary
          key="syllabus"
          kind="syllabus"
          programWide
          copy={{
            eyebrow: 'Program',
            title: 'Published syllabi',
            intro:
              'A syllabus here is offered to every professor teaching that subject. Read it with AI once and every section gets the same week map.',
            emptyTitle: 'Nothing published yet',
            emptyBody:
              'Upload a course outline and it becomes selectable in every professor’s class settings.',
            addLabel: 'Publish syllabus',
            titleLabel: 'Syllabus title',
            titlePlaceholder: 'Quantitative Methods — 1st sem 2026–2027',
          }}
        />
      ) : (
        <ResourceLibrary
          key="curriculum"
          kind="curriculum"
          programWide
          copy={{
            eyebrow: 'Program',
            title: 'Published curricula',
            intro:
              'The program of study itself, published for reference by everybody teaching in it.',
            emptyTitle: 'Nothing published yet',
            emptyBody: 'Upload the curriculum and every professor can open it from their own page.',
            addLabel: 'Publish curriculum',
            titleLabel: 'Curriculum title',
            titlePlaceholder: 'BSIT curriculum — CMO 25 s. 2015',
          }}
        />
      )}
    </div>
  )
}
