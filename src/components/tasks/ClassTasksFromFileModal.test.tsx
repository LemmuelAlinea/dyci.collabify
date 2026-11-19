// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, it, vi } from 'vitest'
import { ClassTasksFromFileModal } from './ClassTasksFromFileModal'
import { createProfessorTask, generateTasksFromFile } from '../../lib/api/tasks'
import { NotesFileError, readNotesFile } from '../../lib/general/notesFile'
import type { FileTask } from '../../lib/classFileTasks'
import type { BoardSummary, ProjectSummary, ProjectTask } from '../../lib/types'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../lib/api/tasks', () => ({ generateTasksFromFile: vi.fn(), createProfessorTask: vi.fn() }))
vi.mock('../../lib/general/notesFile', () => {
  class NotesFileError extends Error {}
  return { NOTES_FILE_ACCEPT: '.pdf,.docx,.xlsx', NotesFileError, readNotesFile: vi.fn() }
})

const project = { id: 'p1', title: 'Prototype' } as ProjectSummary
const boards = [{ id: 'b1', group_name: 'Group 1' }, { id: 'b2', group_name: 'Group 2' }] as BoardSummary[]
const set = (origin: string, board: string, title: string) => ({ origin_id: origin, board_id: board, title }) as ProjectTask
const task = (title: string, fit: FileTask['fit'] = 'fits', due = ''): FileTask => ({ title, details: `${title} details`, weight: 3, due, fit, fit_reason: fit === 'off' ? 'Not in the guidelines, rubric or weeks 5–8.' : '' })
const onSaved = vi.fn(async () => {})
const onClose = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(readNotesFile).mockResolvedValue({ text: 'the task list', cut: false })
  vi.mocked(createProfessorTask).mockResolvedValue({} as never)
})

async function mounted(rows: ProjectTask[], run: (host: HTMLElement) => Promise<void>) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<ClassTasksFromFileModal open onClose={onClose} project={project} boards={boards} rows={rows} onSaved={onSaved} />))
    await run(document.body)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
}
async function upload(host: HTMLElement) {
  const input = host.querySelector<HTMLInputElement>('input[type=file]')!
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'tasks.docx')] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}
const items = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[data-file-task]')]
const ticked = (host: HTMLElement) => items(host).map((li) => li.querySelector('[role=checkbox]')!.getAttribute('aria-checked') === 'true')
const addButton = (host: HTMLElement) => [...host.querySelectorAll('button')].find((b) => /^Add \d+ tasks?$/.test(b.textContent!.trim()))!

it('labels each drafted task and unticks the ones that do not fit or are already set', async () => {
  vi.mocked(generateTasksFromFile).mockResolvedValue({ result: 'ok', note: '', thin: false, tasks: [task('Design the model'), task('Build the loop'), task('Make a TikTok page', 'off'), task('Write the proposal')] })
  await mounted([set('o1', 'b1', 'Write the proposal'), set('o1', 'b2', 'Write the proposal')], async (host) => {
    await upload(host)
    expect(generateTasksFromFile).toHaveBeenCalledWith('p1', 'the task list', 'tasks.docx')
    expect(items(host).map((li) => li.querySelector('[data-fit-label]')!.textContent)).toEqual(['Fits', 'Fits', "Doesn't fit", 'Already set'])
    expect(items(host)[2].textContent).toContain('Not in the guidelines, rubric or weeks 5–8.')
    expect(ticked(host)).toEqual([true, true, false, false])
    expect(host.textContent).toContain('2 of 4 will be added.')
  })
})

it('turns Add off when no task fits, and back on once one is ticked', async () => {
  vi.mocked(generateTasksFromFile).mockResolvedValue({ result: 'ok', note: '', thin: false, tasks: [task('a', 'off'), task('b', 'off'), task('c', 'off')] })
  await mounted([], async (host) => {
    await upload(host)
    expect(host.textContent).toContain('0 of 3 will be added.')
    expect(addButton(host).disabled).toBe(true)
    await act(async () => items(host)[0].querySelector<HTMLElement>('[role=checkbox]')!.click())
    expect(addButton(host).disabled).toBe(false)
  })
})

it('shows the note and no rows when the file has no tasks', async () => {
  vi.mocked(generateTasksFromFile).mockResolvedValue({ result: 'ok', note: 'The file is a reading list, not tasks.', thin: false, tasks: [] })
  await mounted([], async (host) => {
    await upload(host)
    expect(host.textContent).toContain('The file is a reading list, not tasks.')
    expect(items(host)).toHaveLength(0)
    expect(addButton(host)).toBeUndefined()
  })
})

it('on a target change unticks only rows that become already set', async () => {
  vi.mocked(generateTasksFromFile).mockResolvedValue({ result: 'ok', note: '', thin: false, tasks: [task('Make a TikTok page', 'off'), task('Build the loop')] })
  await mounted([set('o1', 'b2', 'Build the loop')], async (host) => {
    await upload(host)
    await act(async () => items(host)[0].querySelector<HTMLElement>('[role=checkbox]')!.click())
    expect(ticked(host)).toEqual([true, true])
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Who gets them"]')!
    await act(async () => { select.value = 'b2'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(ticked(host)).toEqual([true, false])
    expect(items(host)[1].querySelector('[data-fit-label]')!.textContent).toBe('Already set')
  })
})

it('adds each ticked task for the chosen groups', async () => {
  vi.mocked(generateTasksFromFile).mockResolvedValue({ result: 'ok', note: '', thin: false, tasks: [task('Design the model', 'fits', '2026-12-01'), task('Make a TikTok page', 'off'), task('Build the loop')] })
  await mounted([], async (host) => {
    await upload(host)
    await act(async () => addButton(host).click())
    expect(createProfessorTask).toHaveBeenCalledTimes(2)
    expect(createProfessorTask).toHaveBeenNthCalledWith(1, expect.objectContaining({ projectId: 'p1', title: 'Design the model', details: 'Design the model details', weight: 3, boardId: null, aiGenerated: true, dueAt: expect.stringMatching(/^2026-12-01/) }))
    expect(createProfessorTask).toHaveBeenNthCalledWith(2, expect.objectContaining({ title: 'Build the loop', dueAt: null }))
    expect(onSaved).toHaveBeenCalledWith('2 tasks added')
  })
})

it('says what to do when the file cannot be read, without calling the AI', async () => {
  vi.mocked(readNotesFile).mockRejectedValue(new NotesFileError('That PDF has no text to read. It may be a scan; paste the tasks instead.'))
  await mounted([], async (host) => {
    await upload(host)
    expect(host.querySelector('[role=alert]')?.textContent).toContain('That PDF has no text to read.')
    expect(generateTasksFromFile).not.toHaveBeenCalled()
  })
})

it('shows the function refusal', async () => {
  vi.mocked(generateTasksFromFile).mockResolvedValue({ result: 'failed', message: 'That file is empty or nearly so. Upload the one with the tasks in it.' })
  await mounted([], async (host) => {
    await upload(host)
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Upload the one with the tasks in it.')
  })
})
