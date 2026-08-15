import { ResourceLibrary } from './ResourceLibrary'

export default function Syllabi() {
  return (
    <ResourceLibrary
      kind="syllabus"
      copy={{
        eyebrow: 'Teaching',
        title: 'Syllabi',
        intro:
          'Course outlines you can attach to a class, so students always open the version you meant.',
        emptyTitle: 'No syllabi yet',
        emptyBody:
          'Upload a course outline and it becomes selectable when you create or edit a class.',
        addLabel: 'Upload syllabus',
        titleLabel: 'Syllabus title',
        titlePlaceholder: 'Database Management — 1st sem 2025–2026',
      }}
    />
  )
}
