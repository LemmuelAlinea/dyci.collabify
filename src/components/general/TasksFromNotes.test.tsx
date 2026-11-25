// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, it, vi } from 'vitest'
import { TasksFromNotes } from './TasksFromNotes'
import type { GeneralProjectState } from './useGeneralProject'
import { DEFAULT_SPRINT_SETTINGS } from '../../lib/work/sprintSettings'
import { createOpenTask, createTask } from '../../lib/api/general'
import { moveTasksToSprint } from '../../lib/api/sprints'
import { draftWorkTasks } from '../../lib/api/workAi'
import { setTaskEstimate } from '../../lib/api/workload'

const toast = vi.hoisted(() => ({ show: vi.fn() }))
vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../ui/Modal', () => ({ Modal: ({ children, footer }: { children: React.ReactNode; footer: React.ReactNode }) => <div>{children}{footer}</div> }))
vi.mock('../ui/Toast', () => ({ useToast: () => toast }))
vi.mock('../ui/FileDrop', () => ({ FileDrop: ({ onPick }: { onPick: (file: File) => void }) => <button onClick={() => onPick(new File(['task,title'], 'tasks.csv'))}>Choose CSV</button> }))
vi.mock('../../lib/general/notesFile', async (original) => ({ ...await original<object>(), readNotesFile: vi.fn(async () => ({ text: 'Build the first milestone from this CSV', cut: false })) }))
vi.mock('../../lib/api/discussions', () => ({ listDiscussions: vi.fn(async () => [
  { id: 'discussion-1', topic: 'Planning', started_at: '2026-11-26', ended_at: '2026-11-26', folder_id: null },
]), listDiscussionFolders: vi.fn(async () => []) }))
vi.mock('../../lib/general/sharedFiles', () => ({ attachSharedFiles: vi.fn(async () => 0) }))
vi.mock('../../lib/api/general', () => ({ GENERAL_FILE_LIMIT: 10, createTask: vi.fn(async () => 'task-1'), createOpenTask: vi.fn(async () => 'task-1'), uploadTaskFile: vi.fn() }))
vi.mock('../../lib/api/sprints', () => ({ createSprint: vi.fn(), setSprintMilestone: vi.fn(), moveTasksToSprint: vi.fn(async () => {}) }))
vi.mock('../../lib/api/milestones', () => ({ createMilestone: vi.fn(), tagTasks: vi.fn(async () => {}) }))
vi.mock('../../lib/api/workload', () => ({ setTaskEstimate: vi.fn(async () => {}) }))
vi.mock('../../lib/api/workAi', () => ({ draftWorkTasks: vi.fn(async () => ({
  result: 'ok', note: '', shared: [], sprints: [{ name: 'Launch', goal: '', starts_on: '', ends_on: '' }], milestones: [],
  tasks: [{ title: 'Build launch page', description: 'From CSV', assignee: '', team: 'Design', due: '2026-12-02', start: '2026-12-01', sprint: 'Launch', milestone: '', files: [], priority: 'high', task_type: 'Research', estimated_hours: '2' }],
})) }))

beforeEach(() => vi.clearAllMocks())

async function saveDraft(flow: 'planned' | 'open', edit = false, source: 'file' | 'paste' | 'discussion' = 'file') {
  const reload = vi.fn(async () => {})
  const onClose = vi.fn()
  const state = {
    project: { id: 'project-1', class_board_id: null, taskFlow: flow, taskTypeSet: [
      { slot: 'default', name: 'Task' }, { slot: 'bug', name: 'Bug' }, { slot: null, name: 'Research' },
    ] },
    myRole: 'pm', readOnly: false, can: () => true, members: [],
    teams: [{ id: 'team-1', name: 'Design' }],
    sprints: [{ id: 'sprint-1', name: 'Launch', state: 'planned', milestone_id: null }],
    milestones: [], sprintSettings: DEFAULT_SPRINT_SETTINGS,
    roleOf: () => 'member', nameOf: (id: string) => id, reload,
  } as unknown as GeneralProjectState
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const button = (label: string) => [...container.querySelectorAll('button')].find((x) => x.textContent?.includes(label))!
  try {
    await act(async () => root.render(<TasksFromNotes state={state} open onClose={onClose} />))
    if (source === 'file') {
      await act(async () => button('Upload a file').click())
      await act(async () => button('Choose CSV').click())
    } else if (source === 'paste') {
      const notes = container.querySelector('[aria-label="Notes"]') as HTMLTextAreaElement
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(notes, 'Build the first milestone from pasted notes')
        notes.dispatchEvent(new Event('input', { bubbles: true }))
      })
    } else {
      await act(async () => button('From a discussion').click())
      const picker = container.querySelector('[aria-label="Discussion to read"]') as HTMLSelectElement
      await act(async () => { picker.value = 'discussion-1'; picker.dispatchEvent(new Event('change', { bubbles: true })) })
    }
    await act(async () => button('Find the tasks').click())
    const preview = container.textContent ?? ''
    const field = (label: string) => container.querySelector(`[aria-label="Task 1 ${label}"]`) as HTMLInputElement | HTMLSelectElement
    const initial = { priority: field('priority')?.value, type: field('type')?.value, hours: field('estimated hours')?.value }
    if (edit) {
      await act(async () => {
        const priority = field('priority')
        priority.value = 'urgent'
        priority.dispatchEvent(new Event('change', { bubbles: true }))
        const type = field('type')
        type.value = 'bug'
        type.dispatchEvent(new Event('change', { bubbles: true }))
        const hours = field('estimated hours')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(hours, '3.5')
        hours.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await act(async () => button('Add 1 task').click())
    return { preview, initial, reload, onClose }
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
}

it('saves a CSV draft directly as released work in an open project', async () => {
  const { preview, reload } = await saveDraft('open')
  expect(draftWorkTasks).toHaveBeenCalledWith('project-1', { text: 'Build the first milestone from this CSV', file_name: 'tasks.csv' })
  expect(preview).toContain('go straight')
  expect(createOpenTask).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-1', title: 'Build launch page', teamId: 'team-1', holderIds: [] }))
  expect(createTask).not.toHaveBeenCalled()
  expect(moveTasksToSprint).toHaveBeenCalledWith({ kind: 'work', projectId: 'project-1' }, ['task-1'], 'sprint-1')
  expect(reload).toHaveBeenCalledOnce()
})

it('keeps CSV drafts in planning for a planned handoff project', async () => {
  const { preview } = await saveDraft('planned')
  expect(preview).toContain('stay in planning')
  expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-1', title: 'Build launch page', teamId: 'team-1', sprintId: 'sprint-1' }))
  expect(createOpenTask).not.toHaveBeenCalled()
  expect(moveTasksToSprint).not.toHaveBeenCalled()
})

it('shows inferred fields for editing and saves edits in Open flow', async () => {
  const { initial } = await saveDraft('open', true)
  expect(initial).toEqual({ priority: 'high', type: 'Research', hours: '2' })
  expect(createOpenTask).toHaveBeenCalledWith(expect.objectContaining({ priority: 'urgent', kind: 'bug', taskType: null, estimateMinutes: 210 }))
})

it('saves the drafted fields and estimate in Planned flow', async () => {
  const { initial } = await saveDraft('planned')
  expect(initial).toEqual({ priority: 'high', type: 'Research', hours: '2' })
  expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ priority: 'high', kind: 'task', taskType: 'Research' }))
  expect(setTaskEstimate).toHaveBeenCalledWith('task-1', 120)
})

it.each(['paste', 'discussion'] as const)('shows the same editable fields for %s notes', async (source) => {
  const { initial } = await saveDraft('open', false, source)
  expect(initial).toEqual({ priority: 'high', type: 'Research', hours: '2' })
  expect(draftWorkTasks).toHaveBeenCalledWith('project-1', source === 'paste'
    ? { text: 'Build the first milestone from pasted notes' }
    : { discussion_id: 'discussion-1' })
})

it('reports a created planned task when its estimate cannot be saved', async () => {
  vi.mocked(setTaskEstimate).mockRejectedValueOnce(new Error('Estimate unavailable'))
  const { onClose } = await saveDraft('planned')
  expect(createTask).toHaveBeenCalledOnce()
  expect(toast.show).toHaveBeenCalledWith(expect.stringContaining('estimate could not be saved'))
  expect(onClose).toHaveBeenCalledOnce()
})

it('reports a live task when its sprint placement fails', async () => {
  vi.mocked(moveTasksToSprint).mockRejectedValueOnce(new Error('Sprint team differs'))
  const { onClose } = await saveDraft('open')
  expect(createOpenTask).toHaveBeenCalledOnce()
  expect(toast.show).toHaveBeenCalledWith(expect.stringContaining('could not be put in its sprint'))
  expect(onClose).toHaveBeenCalledOnce()
})
