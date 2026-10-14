/**
 * Progress stages: the columns a project's work moves through.
 *
 * A project names 3 to 8 stages, or none for the default three. Every task
 * still has a status, and the status is what reports, grades, locks and late
 * checks read. The first stage is To do, the last is Done, and every stage in
 * between is In progress. supabase/task-stages.sql keeps the two in step.
 */

export type StageStatus = 'todo' | 'in_progress' | 'done'

export const DEFAULT_STAGES = ['To do', 'In progress', 'Done'] as const

export const MIN_STAGES = 3
export const MAX_STAGES = 8
export const MAX_STAGE_LENGTH = 40

export type StagePreset = { id: string; label: string; stages: readonly string[] }

export const STAGE_PRESETS: StagePreset[] = [
  { id: 'default', label: 'Default', stages: DEFAULT_STAGES },
  {
    id: 'system',
    label: 'System development',
    stages: ['Planning', 'Development', 'Testing', 'Revision', 'Completed'],
  },
  {
    id: 'research',
    label: 'Research',
    stages: ['Topic selection', 'Research', 'Drafting', 'Review', 'Revision', 'Final'],
  },
]

/** The stage names a project uses: its own list, or the default three. */
export function stagesOf(stages: readonly string[] | null | undefined): readonly string[] {
  return stages && stages.length >= MIN_STAGES ? stages : DEFAULT_STAGES
}

/** Whether a project still uses the default three, so stage and status are one thing. */
export function isDefaultStages(stages: readonly string[] | null | undefined) {
  const list = stagesOf(stages)
  return list.length === DEFAULT_STAGES.length && list.every((s, i) => s === DEFAULT_STAGES[i])
}

/**
 * The column a task sits in. Status wins at the ends: a todo task is always on
 * the first stage and a done task on the last, whatever was stored. Only an
 * in-progress task's stored stage is read, kept inside the middle stages.
 */
export function stageIndex(status: StageStatus, stage: number | null | undefined, count: number) {
  if (status === 'todo') return 0
  if (status === 'done') return count - 1
  const middle = stage ?? 1
  return Math.min(count - 2, Math.max(1, middle))
}

/** The status a stage means. */
export function statusForStage(index: number, count: number): StageStatus {
  if (index <= 0) return 'todo'
  if (index >= count - 1) return 'done'
  return 'in_progress'
}

/** A task's stage name in its project. */
export function stageName(
  stages: readonly string[] | null | undefined,
  task: { status: StageStatus; stage?: number | null },
) {
  const list = stagesOf(stages)
  return list[stageIndex(task.status, task.stage, list.length)]
}

/** Which preset a list matches, or 'custom'. */
export function presetOf(stages: readonly string[] | null | undefined): string {
  const list = stagesOf(stages)
  const found = STAGE_PRESETS.find(
    (p) => p.stages.length === list.length && p.stages.every((s, i) => s === list[i]),
  )
  return found?.id ?? 'custom'
}

/** Why a list cannot be saved, or null. Mirrors public.stages_ok(). */
export function checkStages(stages: readonly string[]): string | null {
  if (stages.length < MIN_STAGES) return `Use at least ${MIN_STAGES} stages: a start, a middle and an end.`
  if (stages.length > MAX_STAGES) return `Keep it to ${MAX_STAGES} stages.`
  if (stages.some((s) => s.trim().length === 0)) return 'Every stage needs a name.'
  if (stages.some((s) => s.trim().length > MAX_STAGE_LENGTH)) {
    return `Keep each name to ${MAX_STAGE_LENGTH} characters.`
  }
  const seen = new Set(stages.map((s) => s.trim().toLowerCase()))
  if (seen.size !== stages.length) return 'Two stages have the same name.'
  return null
}

/** What gets stored: trimmed, and null for the default three. */
export function stagesToSave(stages: readonly string[]): string[] | null {
  const trimmed = stages.map((s) => s.trim())
  return isDefaultStages(trimmed) ? null : trimmed
}

/** The tone a column or badge takes from the status its stage means. */
export const STAGE_TONE: Record<StageStatus, string> = {
  todo: 'text-pending-ink',
  in_progress: 'text-warning-700 dark:text-warning-300',
  done: 'text-success-700 dark:text-success-300',
}

export type StageStep = { stage: number; status: StageStatus; label: string; icon: 'check' | 'refresh' }

/**
 * The one-click move on a task card: on to the next stage, or back to the
 * first from the last. The default three keep their old words.
 */
export function nextStep(index: number, stages: readonly string[]): StageStep {
  const count = stages.length
  if (index >= count - 1) return { stage: 0, status: 'todo', label: 'Reopen', icon: 'refresh' }
  const to = index + 1
  const status = statusForStage(to, count)
  const label =
    index === 0 ? 'Start' : isDefaultStages(stages) ? 'Mark done' : `Move to ${stages[to]}`
  return { stage: to, status, label, icon: 'check' }
}
