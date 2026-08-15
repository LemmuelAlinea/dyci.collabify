import { RoleHome } from './RoleHome'
import type { Upcoming } from './RoleHome'

const UPCOMING: Upcoming[] = [
  {
    icon: 'users',
    title: 'Advisee groups',
    body: 'Every group you advise on one view, with the stage each of them is currently in.',
  },
  {
    icon: 'checkCircle',
    title: 'Milestone sign-offs',
    body: 'Approve or send back a milestone, with your comments attached where the work is.',
  },
  {
    icon: 'file',
    title: 'Submissions',
    body: 'Chapters and builds as they come in, with the version history behind each one.',
  },
  {
    icon: 'chart',
    title: 'Progress reports',
    body: 'Which groups are on pace and which have not moved a card in two weeks.',
  },
  {
    icon: 'calendar',
    title: 'Consultation calendar',
    body: 'Defense dates and consultation slots your advisees can actually see.',
  },
  {
    icon: 'message',
    title: 'Feedback threads',
    body: 'Comment in place instead of trading email attachments all semester.',
  },
]

export default function ProfessorHome() {
  return (
    <RoleHome
      headline="Your adviser workspace is ready"
      intro="Once groups are set up, this becomes your single view of every capstone you advise. For now, make the account yours."
      upcoming={UPCOMING}
    />
  )
}
