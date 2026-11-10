import type { ProgressKey } from '../api/walkthroughs'
import { canManageProjects, canTeach, isMember, type AccessProfile } from '../access'
import type { GeneralSpaceSummary } from '../general/types'
import { paths } from '../paths'

/**
 * The first-run walkthroughs: which flows a person gets and what each step
 * says, points at and counts as done. Pure data and rules, no UI.
 */

export type FlowId = Exclude<ProgressKey, 'account'>

export type StepId =
  | 'account-photo'
  | 'account-look'
  | 'create-space'
  | 'start-project'
  | 'create-class'
  | 'share-code'
  | 'join-class'
  | 'find-work'
  | 'watch-inbox'

export type WalkthroughFacts = {
  profile: AccessProfile
  stakeholderOnly: boolean
  inClass: boolean
  hasWork: boolean
  spaces: GeneralSpaceSummary[]
}

export type StepDef = {
  id: StepId
  owner: ProgressKey
  title: string
  body: string
  /** Tour target names the step can point at. */
  targets: readonly string[]
  /** Where the step happens, or null when it stays on the current page. */
  route: (f: WalkthroughFacts) => string | null
  /** When set, the step finishes by itself once this is true. */
  isDone?: (f: WalkthroughFacts) => boolean
  /** The button that finishes a step the data cannot finish. */
  press?: 'Next' | 'Done'
  pauseLabel?: string
}

const newestFirst = (a: GeneralSpaceSummary, b: GeneralSpaceSummary) =>
  b.created_at.localeCompare(a.created_at)

/** Live work spaces the person manages, newest first. */
export function pmSpaces(spaces: GeneralSpaceSummary[]): GeneralSpaceSummary[] {
  return spaces
    .filter((s) => s.kind === 'work' && !s.archived_at && s.my_role === 'pm')
    .sort(newestFirst)
}

/** Live classes the person owns or manages, newest first. */
export function taughtClasses(spaces: GeneralSpaceSummary[]): GeneralSpaceSummary[] {
  return spaces
    .filter(
      (s) =>
        s.kind === 'education' &&
        !s.archived_at &&
        s.class_id &&
        (s.my_level === 'owner' || s.my_level === 'manager'),
    )
    .sort(newestFirst)
}

/** Live classes the person is in, in any level, newest first. */
export function joinedClasses(spaces: GeneralSpaceSummary[]): GeneralSpaceSummary[] {
  return spaces
    .filter((s) => s.kind === 'education' && !s.archived_at && s.class_id && s.my_level)
    .sort(newestFirst)
}

export const ACCOUNT_STEPS: readonly StepDef[] = [
  {
    id: 'account-photo',
    owner: 'account',
    title: 'Set up your account',
    body: 'Add a photo so your team knows who you are.',
    targets: ['account-photo'],
    route: () => paths.settings,
    press: 'Next',
  },
  {
    id: 'account-look',
    owner: 'account',
    title: 'Pick your look',
    body: 'Choose light or dark, and your own colors.',
    targets: ['account-look'],
    route: () => paths.settings,
    press: 'Next',
  },
]

export const FLOWS: Record<FlowId, readonly StepDef[]> = {
  teaching: [
    {
      id: 'create-class',
      owner: 'teaching',
      title: 'Create a class',
      body: 'Name it and set its section and term.',
      targets: ['create-class'],
      pauseLabel: "I don't have a section yet",
      route: () => paths.classes,
      isDone: (f) => taughtClasses(f.spaces).length > 0,
    },
    {
      id: 'share-code',
      owner: 'teaching',
      title: 'Share this code with your section',
      body: 'Students join with it, so you never add them by hand.',
      targets: ['class-code'],
      route: (f) => {
        const newest = taughtClasses(f.spaces)[0]
        return newest?.class_id ? paths.class(newest.class_id) : null
      },
      press: 'Done',
    },
  ],
  project_manager: [
    {
      id: 'create-space',
      owner: 'project_manager',
      title: 'Create a space',
      body: 'A space holds your projects.',
      targets: ['create-space'],
      route: () => paths.spaces,
      isDone: (f) => pmSpaces(f.spaces).length > 0,
    },
    {
      id: 'start-project',
      owner: 'project_manager',
      title: 'Start your first project',
      body: 'Name it and pick a starting shape.',
      targets: ['new-project'],
      route: (f) => {
        const newest = pmSpaces(f.spaces)[0]
        return newest ? paths.spaceProjects(newest.id) : null
      },
      isDone: (f) => pmSpaces(f.spaces).some((s) => s.project_count > 0),
    },
  ],
  student: [
    {
      id: 'join-class',
      owner: 'student',
      title: 'Join your class',
      body: 'Enter the code from your professor.',
      targets: ['join-class'],
      route: () => paths.home,
      isDone: (f) => f.inClass,
      pauseLabel: "I don't have a code yet",
    },
    {
      id: 'find-work',
      owner: 'student',
      title: 'Find your work',
      body: 'My tasks and Groups fill up from your class.',
      targets: ['nav-tasks', 'nav-groups'],
      route: (f) => {
        const newest = joinedClasses(f.spaces)[0]
        return newest?.class_id ? paths.class(newest.class_id) : paths.home
      },
      press: 'Done',
    },
  ],
  member: [
    {
      id: 'watch-inbox',
      owner: 'member',
      title: 'Invitations land in your Inbox',
      body: 'Work opens once you accept one.',
      targets: ['open-inbox'],
      route: () => paths.home,
      isDone: (f) => f.hasWork || f.inClass,
      press: 'Done',
    },
  ],
}

export const END_CARDS: Partial<Record<FlowId, { title: string; body: string }>> = {
  project_manager: {
    title: 'Your project is ready',
    body: 'Invite your people from Settings → Members on this project.',
  },
}

/** The walkthroughs this person gets, in the order they run. */
export function flowsFor(f: WalkthroughFacts): FlowId[] {
  const p = f.profile
  if (!p || p.status !== 'active' || f.stakeholderOnly) return []
  if (p.role === 'student') return ['student']
  if (!isMember(p)) return []
  const flows: FlowId[] = []
  if (canTeach(p)) flows.push('teaching')
  if (canManageProjects(p)) flows.push('project_manager')
  return flows.length > 0 ? flows : ['member']
}
