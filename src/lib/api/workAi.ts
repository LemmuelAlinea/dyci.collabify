import { invokeFunction } from './functions'

/**
 * The work-project AI helpers. Each returns a draft or an answer; nothing is
 * written. A refusal (limits, permissions, nothing to read) comes back as
 * `result: 'failed'` with a message to show as it is.
 */
type Failed = { result: 'failed'; message: string }
type Ok<T> = { result: 'ok' } & T

function call<T>(action: string, projectId: string, body: Record<string, unknown>) {
  return invokeFunction<Ok<T> | Failed>('work-ai', { action, project_id: projectId, ...body })
}

export type DraftedWorkTask = {
  title: string
  description: string
  assignee: string
  team: string
  due: string
  /** YYYY-MM-DD the text says the work starts, or ''. */
  start: string
  /** Name of one of the drafted sprints, or '' for the backlog. */
  sprint: string
  /** Name of one of the drafted milestones, or ''. */
  milestone: string
  /** Shared discussion files the discussion ties to this task (their ids). */
  files: string[]
}

/** A sprint the text lays out. Dates are '' when it gives none. */
export type DraftedSprint = { name: string; goal: string; starts_on: string; ends_on: string }
export type DraftedMilestone = {
  name: string
  description: string
  due: string
  /** Names of drafted sprints the text says count toward it. Optional: an older deploy sends none. */
  sprints?: string[]
}

/** A file shared in the discussion the draft read. */
export type DraftSharedFile = { id: string; name: string; path: string; mime: string | null; size: number }

/**
 * Action items from pasted notes, an uploaded file's text, or a stopped
 * discussion's file, with the sprints and milestones the text lays out.
 */
export const draftWorkTasks = (
  projectId: string,
  source: { text: string; file_name?: string } | { discussion_id: string },
) =>
  call<{
    tasks: DraftedWorkTask[]
    note: string
    shared?: DraftSharedFile[]
    // Optional: an older deploy of the function sends neither.
    sprints?: DraftedSprint[]
    milestones?: DraftedMilestone[]
  }>('tasks', projectId, source)

/** From the caller's draft (optionally just these paths), or from text on screen. */
export const writeChangeMessage = (
  projectId: string,
  source: { paths?: string[]; files?: { path: string; kind: string; content: string }[] },
) => call<{ title: string; message: string }>('describe', projectId, source)

export const summarizeChange = (projectId: string, changeId: string) =>
  call<{ overall: string; files: { path: string; summary: string }[] }>('summarize-change', projectId, {
    change_id: changeId,
  })

export const summarizeFile = (projectId: string, path: string) =>
  call<{ points: string[] }>('summarize-file', projectId, { path })

export const draftFormula = (
  projectId: string,
  input: { description: string; headers: string[]; sample: string[][]; cell?: string },
) => call<{ formula: string; explanation: string }>('formula', projectId, input)

export const askFiles = (projectId: string, question: string) =>
  call<{ answer: string; found: boolean; sources: string[]; skipped: number }>('ask', projectId, { question })
