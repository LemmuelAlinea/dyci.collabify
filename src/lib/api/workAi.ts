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
}

/** Action items from pasted notes, or from a stopped discussion's file. */
export const draftWorkTasks = (projectId: string, source: { text: string } | { discussion_id: string }) =>
  call<{ tasks: DraftedWorkTask[]; note: string }>('tasks', projectId, source)

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
