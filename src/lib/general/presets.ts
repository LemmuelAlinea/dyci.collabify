/**
 * Project presets — the starting shapes real Dr. Yanga's Colleges projects take.
 *
 * A preset is only a head start: it writes fields, teams, positions and tasks
 * into a new project and then steps out of the way. Nothing it creates is
 * locked, because the whole point of the General workplace is that a project's
 * every field is the creator's to change.
 *
 * The content lives here rather than in the database so it can be read, edited
 * and reviewed like the rest of the product. `create_general_project` takes it
 * as one JSON payload and applies it in a single transaction, so a project is
 * never half set up.
 */
import type { FieldType } from './fields'

export type PresetAudience = 'basic' | 'senior' | 'college' | 'faculty' | 'school'

export type PresetField = {
  name: string
  type: FieldType
  options?: string[]
}

export type PresetTask = {
  title: string
  description?: string
  /** Matches a team name in the same preset. Anything else covers the project. */
  team?: string
}

export type Preset = {
  id: string
  name: string
  blurb: string
  icon: 'folder' | 'kanban' | 'file' | 'chart' | 'users' | 'calendar'
  /** Who at the school runs this kind of project, for grouping the picker. */
  audience: PresetAudience[]
  fields: PresetField[]
  teams: string[]
  /** A position with no team covers the whole project. */
  positions: { name: string; team?: string }[]
  tasks: PresetTask[]
}

const RESEARCH_STAGE = [
  'Title proposal',
  'Chapters 1 to 3',
  'Proposal defence',
  'Data gathering',
  'Chapters 4 and 5',
  'Final defence',
  'Bound and submitted',
]

export const PRESETS: Preset[] = [
  {
    id: 'blank',
    name: 'Blank project',
    blurb: 'Start with nothing and add what you need.',
    icon: 'folder',
    audience: ['basic', 'senior', 'college', 'faculty', 'school'],
    fields: [],
    teams: [],
    positions: [],
    tasks: [],
  },
  {
    id: 'research_paper',
    name: 'Research paper',
    blurb: 'A thesis or research study, from title proposal to final defence.',
    icon: 'file',
    audience: ['senior', 'college'],
    fields: [
      { name: 'Research title', type: 'short_text' },
      { name: 'Stage', type: 'single_choice', options: RESEARCH_STAGE },
      { name: 'Adviser', type: 'short_text' },
      { name: 'Research design', type: 'single_choice', options: ['Quantitative', 'Qualitative', 'Mixed methods'] },
      { name: 'Respondents or sample', type: 'short_text' },
      { name: 'Ethics clearance', type: 'yes_no' },
      { name: 'Defence date', type: 'date' },
      { name: 'Statement of the problem', type: 'long_text' },
    ],
    teams: [],
    positions: [
      { name: 'Adviser' },
      { name: 'Lead researcher' },
      { name: 'Statistician' },
      { name: 'Documentation' },
    ],
    tasks: [
      { title: 'Draft three title proposals', description: 'Bring them to the adviser and keep the one approved.' },
      { title: 'Write Chapter 1 — the problem and its background' },
      { title: 'Write Chapter 2 — review of related literature' },
      { title: 'Write Chapter 3 — methodology' },
      { title: 'Book the proposal defence' },
      { title: 'Prepare and validate the instrument' },
      { title: 'Gather data' },
      { title: 'Write Chapter 4 — results and discussion' },
      { title: 'Write Chapter 5 — conclusions and recommendations' },
      { title: 'Book the final defence' },
      { title: 'Apply the panel comments' },
      { title: 'Have it bound and submit it' },
    ],
  },
  {
    id: 'capstone',
    name: 'Capstone or system development',
    blurb: 'Software built for a client, from requirements to deployment.',
    icon: 'kanban',
    audience: ['senior', 'college'],
    fields: [
      { name: 'Client or beneficiary', type: 'short_text' },
      { name: 'Stage', type: 'single_choice', options: RESEARCH_STAGE },
      { name: 'Adviser', type: 'short_text' },
      { name: 'Platform', type: 'multi_choice', options: ['Web', 'Mobile', 'Desktop', 'Hardware'] },
      { name: 'Repository', type: 'link' },
      { name: 'Deployed at', type: 'link' },
      { name: 'Defence date', type: 'date' },
    ],
    teams: ['Development', 'Documentation', 'Testing'],
    positions: [
      { name: 'Adviser' },
      { name: 'Project manager' },
      { name: 'Lead developer', team: 'Development' },
      { name: 'Technical writer', team: 'Documentation' },
      { name: 'Tester', team: 'Testing' },
    ],
    tasks: [
      { title: 'Agree the scope with the client', description: 'Write down what is in and what is out.' },
      { title: 'Gather requirements' },
      { title: 'Design the data model', team: 'Development' },
      { title: 'Design the screens', team: 'Development' },
      { title: 'Build the core feature', team: 'Development' },
      { title: 'Write the user manual', team: 'Documentation' },
      { title: 'Write the test plan', team: 'Testing' },
      { title: 'Run user acceptance testing with the client', team: 'Testing' },
      { title: 'Deploy it' },
      { title: 'Book the final defence' },
    ],
  },
  {
    id: 'action_research',
    name: 'Action research',
    blurb: 'A teacher-led study on a real classroom or campus problem.',
    icon: 'chart',
    audience: ['faculty', 'school'],
    fields: [
      { name: 'Problem being addressed', type: 'long_text' },
      { name: 'Stage', type: 'single_choice', options: ['Planning', 'Acting', 'Observing', 'Reflecting', 'Reported'] },
      { name: 'Grade level or department', type: 'short_text' },
      { name: 'Intervention', type: 'long_text' },
      { name: 'Cycle ends', type: 'date' },
      { name: 'Funded', type: 'yes_no' },
      { name: 'Budget', type: 'money' },
    ],
    teams: [],
    positions: [{ name: 'Lead teacher' }, { name: 'Co-researcher' }, { name: 'Department head' }],
    tasks: [
      { title: 'Write the problem statement' },
      { title: 'Review what has already been tried' },
      { title: 'Plan the intervention' },
      { title: 'Take the baseline measurement' },
      { title: 'Run the intervention' },
      { title: 'Observe and record what happened' },
      { title: 'Take the endline measurement' },
      { title: 'Write the reflection and the report' },
      { title: 'Present it to the department' },
    ],
  },
  {
    id: 'competition',
    name: 'Competition entry',
    blurb: 'Robotics, quiz bees, sports and academic contests outside the school.',
    icon: 'users',
    audience: ['basic', 'senior', 'college'],
    fields: [
      { name: 'Competition', type: 'short_text' },
      { name: 'Category', type: 'short_text' },
      { name: 'Host or organiser', type: 'short_text' },
      { name: 'Competition date', type: 'date' },
      { name: 'Venue', type: 'short_text' },
      { name: 'Registration paid', type: 'yes_no' },
      { name: 'Budget', type: 'money' },
      { name: 'Coach', type: 'member' },
      { name: 'Result', type: 'short_text' },
    ],
    teams: ['Team A', 'Support'],
    positions: [
      { name: 'Coach' },
      { name: 'Team captain', team: 'Team A' },
      { name: 'Chaperone', team: 'Support' },
    ],
    tasks: [
      { title: 'Read the mechanics and the rules' },
      { title: 'Register the team' },
      { title: "Get the parents' consent forms signed", team: 'Support' },
      { title: 'Set the practice schedule' },
      { title: 'Build and test the entry', team: 'Team A' },
      { title: 'Arrange transport and food', team: 'Support' },
      { title: 'Do a dry run' },
      { title: 'Compete' },
      { title: 'Write the post-competition report' },
    ],
  },
  {
    id: 'school_event',
    name: 'School event',
    blurb: 'Intramurals, foundation day, recognition, a seminar or a fair.',
    icon: 'calendar',
    audience: ['basic', 'senior', 'college', 'faculty', 'school'],
    fields: [
      { name: 'Event date', type: 'date' },
      { name: 'Venue', type: 'short_text' },
      { name: 'Expected attendance', type: 'number' },
      { name: 'Budget', type: 'money' },
      { name: 'Approved by the office', type: 'yes_no' },
      { name: 'Theme', type: 'short_text' },
    ],
    teams: ['Program', 'Logistics', 'Finance', 'Publicity'],
    positions: [
      { name: 'Overall chairperson' },
      { name: 'Adviser' },
      { name: 'Program head', team: 'Program' },
      { name: 'Logistics head', team: 'Logistics' },
      { name: 'Treasurer', team: 'Finance' },
      { name: 'Publicity head', team: 'Publicity' },
    ],
    tasks: [
      { title: 'Write the concept and get it approved' },
      { title: 'Book the venue and the date', team: 'Logistics' },
      { title: 'Draw up the budget', team: 'Finance' },
      { title: 'Build the program flow', team: 'Program' },
      { title: 'Invite the guests and the speakers', team: 'Program' },
      { title: 'Arrange sound, lights and seating', team: 'Logistics' },
      { title: 'Post the announcements', team: 'Publicity' },
      { title: 'Run the rehearsal' },
      { title: 'Run the event' },
      { title: 'Liquidate the budget', team: 'Finance' },
      { title: 'Write the after-event report' },
    ],
  },
  {
    id: 'outreach',
    name: 'Community extension',
    blurb: 'NSTP, CWTS and outreach work with a partner community.',
    icon: 'users',
    audience: ['senior', 'college', 'faculty'],
    fields: [
      { name: 'Partner community', type: 'short_text' },
      { name: 'Barangay and municipality', type: 'short_text' },
      { name: 'Activity date', type: 'date' },
      { name: 'Beneficiaries reached', type: 'number' },
      { name: 'Budget', type: 'money' },
      { name: 'Memorandum signed', type: 'yes_no' },
      { name: 'Needs assessed', type: 'long_text' },
    ],
    teams: ['Program', 'Logistics', 'Documentation'],
    positions: [
      { name: 'Adviser' },
      { name: 'Team leader' },
      { name: 'Documenter', team: 'Documentation' },
    ],
    tasks: [
      { title: 'Assess what the community needs' },
      { title: "Get the barangay's clearance" },
      { title: 'Sign the memorandum of agreement' },
      { title: 'Plan the activity', team: 'Program' },
      { title: 'Gather the materials', team: 'Logistics' },
      { title: 'Run the activity' },
      { title: 'Photograph and record it', team: 'Documentation' },
      { title: 'Write the terminal report', team: 'Documentation' },
    ],
  },
  {
    id: 'accreditation',
    name: 'Accreditation or quality assurance',
    blurb: 'Gathering the documents a visiting body asks a programme for.',
    icon: 'file',
    audience: ['faculty', 'school'],
    fields: [
      { name: 'Accrediting body', type: 'short_text' },
      { name: 'Programme', type: 'short_text' },
      { name: 'Level applied for', type: 'short_text' },
      { name: 'Visit date', type: 'date' },
      { name: 'Areas covered', type: 'multi_choice', options: [
        'Vision, mission and goals',
        'Faculty',
        'Curriculum and instruction',
        'Support to students',
        'Research',
        'Extension and community involvement',
        'Library',
        'Physical plant and facilities',
        'Laboratories',
        'Administration',
      ] },
      { name: 'Self-survey done', type: 'yes_no' },
    ],
    teams: ['Documentation', 'Facilities'],
    positions: [
      { name: 'Programme head' },
      { name: 'Accreditation coordinator' },
      { name: 'Area custodian', team: 'Documentation' },
    ],
    tasks: [
      { title: 'Read the instrument and split the areas' },
      { title: 'Run the self-survey' },
      { title: 'Gather the evidence for each area', team: 'Documentation' },
      { title: 'Fix what the self-survey found' },
      { title: 'Prepare the exhibit room', team: 'Facilities' },
      { title: 'Rehearse the walkthrough' },
      { title: 'Host the visit' },
      { title: 'Answer the findings' },
    ],
  },
  {
    id: 'feasibility',
    name: 'Feasibility study or business plan',
    blurb: 'A costed proposal for a product, service or enterprise.',
    icon: 'chart',
    audience: ['senior', 'college'],
    fields: [
      { name: 'Product or service', type: 'short_text' },
      { name: 'Target market', type: 'short_text' },
      { name: 'Capital needed', type: 'money' },
      { name: 'Projected monthly sales', type: 'money' },
      { name: 'Break-even month', type: 'number' },
      { name: 'Adviser', type: 'short_text' },
      { name: 'Presentation date', type: 'date' },
    ],
    teams: [],
    positions: [{ name: 'Adviser' }, { name: 'Team leader' }, { name: 'Finance lead' }],
    tasks: [
      { title: 'Pick the product or service' },
      { title: 'Study the market' },
      { title: 'Work out the technical requirements' },
      { title: 'Work out the organisation and management' },
      { title: 'Build the financial projections' },
      { title: 'Assess the socio-economic impact' },
      { title: 'Write the recommendation' },
      { title: 'Present it' },
    ],
  },
  {
    id: 'class_group',
    name: 'Classroom group work',
    blurb: 'A performance task or group output for one subject.',
    icon: 'folder',
    audience: ['basic', 'senior'],
    fields: [
      { name: 'Subject', type: 'short_text' },
      { name: 'Teacher', type: 'short_text' },
      { name: 'Grade and section', type: 'short_text' },
      { name: 'Due', type: 'date' },
      { name: 'Output', type: 'single_choice', options: ['Report', 'Poster', 'Model', 'Performance', 'Video', 'Essay'] },
      { name: 'Rubric', type: 'link' },
    ],
    teams: [],
    positions: [{ name: 'Leader' }, { name: 'Secretary' }],
    tasks: [
      { title: 'Read the rubric together' },
      { title: 'Split the parts' },
      { title: 'Draft each part' },
      { title: 'Put the parts together' },
      { title: 'Check it against the rubric' },
      { title: 'Submit it' },
    ],
  },
]

export const AUDIENCE_LABEL: Record<PresetAudience, string> = {
  basic: 'Elementary and junior high',
  senior: 'Senior high',
  college: 'College',
  faculty: 'Faculty',
  school: 'School-wide',
}

export function presetById(id: string | null | undefined) {
  if (!id) return null
  return PRESETS.find((p) => p.id === id) ?? null
}

export function presetsFor(audience: PresetAudience | '') {
  if (!audience) return PRESETS
  return PRESETS.filter((p) => p.audience.includes(audience))
}

/** What the picker says a preset will add, without listing all of it. */
export function presetSummary(preset: Preset) {
  const parts: string[] = []
  const add = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`)
  }
  add(preset.fields.length, 'field', 'fields')
  add(preset.teams.length, 'team', 'teams')
  add(preset.positions.length, 'position', 'positions')
  add(preset.tasks.length, 'task', 'tasks')
  if (parts.length === 0) return 'Nothing added'
  const last = parts.pop() as string
  return parts.length === 0 ? last : `${parts.join(', ')} and ${last}`
}

/**
 * The payload `create_general_project` applies. Teams and positions are named,
 * not keyed, because the database assigns the ids — a task or a position points
 * at a team by the name the preset gave it.
 */
export type PresetPayload = {
  fields: { name: string; type: FieldType; options: string[]; sort: number }[]
  teams: string[]
  positions: { name: string; team: string | null }[]
  tasks: { title: string; description: string; team: string | null }[]
}

export function presetPayload(preset: Preset): PresetPayload {
  const teams = preset.teams
  const named = (team: string | undefined) => (team && teams.includes(team) ? team : null)
  return {
    fields: preset.fields.map((f, i) => ({
      name: f.name,
      type: f.type,
      options: f.options ?? [],
      sort: i,
    })),
    teams,
    positions: preset.positions.map((p) => ({ name: p.name, team: named(p.team) })),
    tasks: preset.tasks.map((t) => ({
      title: t.title,
      description: t.description ?? '',
      team: named(t.team),
    })),
  }
}
