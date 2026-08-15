import { ResourceLibrary } from './ResourceLibrary'

export default function Curriculum() {
  return (
    <ResourceLibrary
      kind="curriculum"
      copy={{
        eyebrow: 'Teaching',
        title: 'Curriculum',
        intro:
          'Program curricula for the BSIT track. Attach one to a class so its place in the program is clear.',
        emptyTitle: 'No curricula yet',
        emptyBody:
          'Upload a program curriculum and it becomes selectable when you create or edit a class.',
        addLabel: 'Upload curriculum',
        titleLabel: 'Curriculum title',
        titlePlaceholder: 'BSIT Curriculum — 2024 revision',
      }}
    />
  )
}
