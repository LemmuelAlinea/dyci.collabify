import { RoleHome } from './RoleHome'
import type { Upcoming } from './RoleHome'

const UPCOMING: Upcoming[] = [
  {
    icon: 'kanban',
    title: 'Project board',
    body: 'Backlog, in progress, and review columns for your group, with an owner on every card.',
  },
  {
    icon: 'check',
    title: 'My tasks',
    body: 'Everything assigned to you across the semester, sorted by what is due next.',
  },
  {
    icon: 'target',
    title: 'Milestones',
    body: 'Title defense to final defense on one timeline, with adviser sign-off at each gate.',
  },
  {
    icon: 'folder',
    title: 'Files and versions',
    body: 'Chapters, ERDs, and build drops in one place, with the previous version kept.',
  },
  {
    icon: 'message',
    title: 'Group discussion',
    body: 'Threaded comments on the card they belong to, not scattered across chat apps.',
  },
  {
    icon: 'chart',
    title: 'Contribution log',
    body: 'A record of who moved what and when, so group grades reflect the actual work.',
  },
]

export default function StudentHome() {
  return (
    <RoleHome
      headline="Your workspace is ready"
      intro="This is where your capstone board will live. While the project tools are being built, your profile and preferences are already yours to set."
      upcoming={UPCOMING}
    />
  )
}
