import { ResourceLibrary } from '../resources/ResourceLibrary'

/**
 * What the program publishes once, for every section of a course: syllabi at
 * `/admin/syllabi`, curricula at `/admin/curriculum`.
 *
 * Two sections of one subject running different outlines is the thing this
 * fixes. A syllabus published here is the same kind of row a professor uploads
 * for themselves — same table, same id — so attaching it to a class, reading it
 * with AI and mapping its weeks all work exactly as they already did.
 *
 * Publishing is the chair's alone, and the database enforces that rather than
 * this page: a trigger refuses `program_wide` from anybody who is not an admin.
 */
export default function ProgramLibrary({ kind }: { kind: 'syllabus' | 'curriculum' }) {
  // Syllabi and Curriculum each have their own row in the admin rail, so the
  // page no longer carries a switch between them.
  return (
    <div>
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
