// The class project brief the AI functions read (guidelines, rubric, the
// syllabus weeks it covers), and the fit check that judges tasks drafted from
// a file against it. Shared by generate-tasks and work-ai so both judge the
// same way. Pure apart from readClassBrief, which reads through the caller's
// token so RLS decides what the brief may hold.

import { validDay } from './notesSchedule.ts'

export type ClassBriefData = {
  project: {
    title: string
    type: string
    type_label: string | null
    audience: string
    total_points: number
    due_at: string | null
    guidelines: string | null
    start_week: number
    end_week: number
  }
  criteria: { label: string; description: string; max_points: number }[]
  weeks: { week_no: number; title: string; topics: string; outcomes: string; assessments: string }[]
}

type Week = ClassBriefData['weeks'][number]
const weekHasDetail = (w: Week) => Boolean(w.topics || w.outcomes || w.assessments)

/**
 * The brief as text, and whether it is too thin to judge a task against: no
 * guidelines, no rubric and no week with detail, all three. The board lines
 * (team size, tasks the team already has) are Draft with AI's alone.
 */
export function buildClassBrief(
  data: ClassBriefData,
  extras: { teamSize?: number; existing?: string[] } = {},
): { text: string; thin: boolean } {
  const { project, criteria, weeks } = data
  const teamSize = extras.teamSize ?? 0
  const existing = extras.existing ?? []
  const text = [
    `Project: ${project.title}`,
    `Type: ${project.type_label || project.type}`,
    `Done by: ${project.audience === 'group' ? 'a group together' : 'each student alone'}`,
    teamSize > 0 ? `Team size: ${teamSize}` : '',
    `Worth: ${project.total_points} points`,
    project.due_at ? `Due: ${new Date(project.due_at).toDateString()}` : 'No deadline set',
    '',
    'Guidelines from the professor:',
    project.guidelines?.trim() || '(none written)',
    '',
    'Rubric:',
    criteria.length > 0
      ? criteria.map((c) => `- ${c.label} (${c.max_points} pts)${c.description ? `: ${c.description}` : ''}`).join('\n')
      : '(none set — mark on the total)',
    '',
    `Syllabus weeks ${project.start_week}–${project.end_week} it is built on:`,
    weeks
      .map((w) =>
        [
          `Week ${w.week_no}: ${w.title}`,
          w.topics ? `  Topics: ${w.topics}` : '',
          w.outcomes ? `  Outcomes: ${w.outcomes}` : '',
          w.assessments ? `  Expected: ${w.assessments}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n') || '(no week detail)',
    existing.length > 0 ? `\nTasks the team already has, do not repeat them:\n${existing.map((t) => `- ${t}`).join('\n')}` : '',
  ]
    .filter((line) => line !== '')
    .join('\n')
  const thin = !project.guidelines?.trim() && criteria.length === 0 && !weeks.some(weekHasDetail)
  return { text, thin }
}

/** The brief's rows, read through the caller's token; null when the project is not theirs to read. */
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readClassBrief(caller: { from: (table: string) => any }, projectId: string): Promise<ClassBriefData | null> {
  const { data: project } = await caller
    .from('project_overview')
    .select('id, title, type, type_label, guidelines, total_points, due_at, audience, start_week, end_week, class_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) return null
  const [{ data: criteria }, { data: weeks }] = await Promise.all([
    caller.from('project_criteria').select('label, description, max_points').eq('project_id', projectId).order('position'),
    caller
      .from('class_week_map')
      .select('week_no, title, topics, outcomes, assessments')
      .eq('class_id', project.class_id)
      .gte('week_no', project.start_week)
      .lte('week_no', project.end_week)
      .order('week_no'),
  ])
  return { project, criteria: criteria ?? [], weeks: weeks ?? [] }
}

export const THIN_NOTE = 'This project has too little written to check the tasks against.'

export const FIT_RULES = `Fit check. The class project brief is given below. For every task:
- fit: "fits" when the task carries out something the guidelines, the rubric or
  the listed syllabus weeks ask for, or a step plainly needed to deliver it
  (research, design, build, test, document or present the project's own work).
  "off" when it serves none of them: unrelated to the project's subject, a
  generic chore (a group chat, snacks, a social media page), or work for
  another course. Judge the meaning, not shared words.
- fit_reason: when fit is "off", one short sentence naming what it does not
  match, e.g. "Not in the guidelines, rubric or weeks 5–8." Empty when it fits.
- Never leave a task out because it does not fit; list every task and mark it.`

export const FIT_SCHEMA_FIELDS = {
  fit: { type: 'string', enum: ['fits', 'off'] },
  fit_reason: { type: 'string' },
} as const

/** Anything but an explicit "off" is a fit; a thin brief never marks off. */
export function normalizeFit(raw: unknown, reason: unknown, thin: boolean): { fit: 'fits' | 'off'; fit_reason: string } {
  if (thin || raw !== 'off') return { fit: 'fits', fit_reason: '' }
  return { fit: 'off', fit_reason: String(reason ?? '').trim().slice(0, 200) }
}

/** The most tasks one file can draft. */
export const FILE_TASK_LIMIT = 100

export type FileTask = { title: string; details: string; weight: number; due: string; fit: 'fits' | 'off'; fit_reason: string }

/** The model's reply as rows the app can show: in order, cleaned, capped, each with its verdict. */
export function shapeFileTasks(parsed: unknown, thin: boolean): FileTask[] {
  const list = (parsed as { tasks?: unknown } | null)?.tasks
  if (!Array.isArray(list)) return []
  return list
    .map((t: Record<string, unknown>) => ({
      title: String(t?.title ?? '').trim().slice(0, 140),
      details: String(t?.details ?? '').trim().slice(0, 600),
      weight: Math.max(1, Math.min(20, Math.round(Number(t?.weight)) || 1)),
      due: validDay(t?.due),
      ...normalizeFit(t?.fit, t?.fit_reason, thin),
    }))
    .filter((t) => t.title.length > 0)
    .slice(0, FILE_TASK_LIMIT)
}
