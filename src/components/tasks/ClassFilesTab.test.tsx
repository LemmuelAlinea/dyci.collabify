// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ClassFilesTab } from './ClassFilesTab'
import { classBoardRepoId, ensureClassBoardRepo } from '../../lib/api/tasks'
import { draftConflicts, getRepo, listDraftFiles, listShares, myDraft } from '../../lib/api/general'
import { useGeneralProject } from '../general/useGeneralProject'
import type { GeneralProjectState } from '../general/useGeneralProject'
import type { ProjectTasks } from './useProjectTasks'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../../hooks/useLive', () => ({ useLive: vi.fn() }))
vi.mock('../general/DiscussionTab', () => ({ DiscussionTab: () => 'Discussion' }))
vi.mock('../general/useGeneralProject', () => ({ useGeneralProject: vi.fn() }))
vi.mock('../../lib/api/tasks', () => ({
  classBoardRepoId: vi.fn(),
  ensureClassBoardRepo: vi.fn(),
}))
vi.mock('../../lib/api/workAi', () => ({
  askFiles: vi.fn(),
  summarizeFile: vi.fn(),
  summarizeChange: vi.fn(),
  writeChangeMessage: vi.fn(),
}))
vi.mock('../../lib/api/general', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getRepo: vi.fn(),
  listTree: async () => [
    { repo_id: 'repo', path: 'report/notes.md', kind: 'text', content: 'Hello', storage_path: null },
    { repo_id: 'repo', path: 'report/scan.zip', kind: 'binary', content: '', storage_path: 'p/files/scan.zip' },
  ],
  listCommits: async () => [],
  listRepoChanges: async () => [
    {
      id: 'c1', project_id: 'p', repo_id: 'repo', title: 'Add the method chapter', body: null,
      status: 'open', author_id: 's1', reviewer_id: null, reviewer_ids: [], base_seq: 1,
      files: [{ path: 'notes.md', action: 'changed', kind: 'text', content: 'Hi', storage_path: null }],
      created_at: '2026-11-01T00:00:00Z', decided_by: null, decided_note: null,
    },
  ],
  listRepoComments: async () => [
    { id: 'k1', change_id: 'c1', author_id: 's2', path: null, body: 'Looks right', created_at: '2026-11-01T00:00:00Z' },
  ],
  contentAt: async () => null,
  // What these refuse a teacher with: the read-only view must never ask.
  myDraft: vi.fn(async () => {
    throw new Error('You are not on this project.')
  }),
  listDraftFiles: vi.fn(async () => []),
  draftConflicts: vi.fn(async () => []),
  listShares: vi.fn(),
}))

const repo = { id: 'repo', project_id: 'p', name: 'Files', file_count: 2, commit_count: 1, last_author: 's1', last_commit_at: null }

const board = { id: 'b1', submitted_at: null }
const t = { boards: [board], active: board, locked: false, solo: false } as unknown as ProjectTasks

/**
 * What useGeneralProject hands a teacher on a class board's Files project: no
 * role, and nothing archived. It claims every right, so the test shows that
 * ClassFilesTab itself, not the hook, keeps the view read-only.
 */
const loaded = {
  project: { id: 'p', class_board_id: 'b1', has_code: false, preset: 'class-board' },
  loading: false, error: null, me: null, myRole: null, archived: false, readOnly: false,
  viewerId: 'prof', can: () => true, nameOf: (id: string) => id,
  commitRights: { commit: false, grant: false, board: false, committers: [] },
} as unknown as GeneralProjectState

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null

beforeEach(() => {
  vi.mocked(useGeneralProject).mockImplementation((id) => (id ? loaded : ({ ...loaded, project: null } as never)))
  vi.mocked(getRepo).mockResolvedValue(repo as never)
  vi.mocked(listShares).mockResolvedValue([])
})

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = null
  root = null
  vi.clearAllMocks()
})

async function show(props: Partial<React.ComponentProps<typeof ClassFilesTab>>, at = '/?tab=files') {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <MemoryRouter initialEntries={[at]}>
        <ClassFilesTab t={t} viewerId="prof" {...props} />
      </MemoryRouter>,
    ),
  )
  // Let the repo id, then the repo and its tree, land.
  await act(async () => {})
  await act(async () => {})
}

const page = () => document.body.textContent ?? ''
const buttons = () => [...document.body.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '')
const errors = () => document.body.querySelectorAll('[role="alert"]')

function expectNoWrites() {
  const labels = buttons()
  for (const write of ['New', 'Rename', 'Save to my draft', 'Commit to Main', 'Comment', 'Close', 'Merge', 'Request access']) {
    expect(labels).not.toContain(write)
  }
  expect(document.body.querySelector('[aria-label="Remove comment"]')).toBeNull()
  expect(document.body.querySelector('[aria-label="Write a comment"]')).toBeNull()
  expect(page()).not.toContain('My workspace')
}

it('finds a teacher the group files without opening them, and says when there are none', async () => {
  vi.mocked(classBoardRepoId).mockResolvedValue(null)
  await show({ readOnly: true })
  expect(classBoardRepoId).toHaveBeenCalledWith('b1')
  expect(ensureClassBoardRepo).not.toHaveBeenCalled()
  expect(page()).toContain('No files yet')
  expect(page()).toContain('This group has not added any files.')
  expect(getRepo).not.toHaveBeenCalled()
})

it('shows a teacher the tree with no write control, and never asks for a draft', async () => {
  vi.mocked(classBoardRepoId).mockResolvedValue('p')
  await show({ readOnly: true })
  expect(ensureClassBoardRepo).not.toHaveBeenCalled()
  expect(useGeneralProject).toHaveBeenLastCalledWith('p', 'prof')
  expect(page()).toContain('report')
  expect(page()).toContain('Project files')
  expect(myDraft).not.toHaveBeenCalled()
  expect(listDraftFiles).not.toHaveBeenCalled()
  expect(draftConflicts).not.toHaveBeenCalled()
  expect(errors()).toHaveLength(0)
  expect(page()).not.toContain('did not load')
  // The AI helpers answer members only.
  expect(document.body.querySelector('[aria-label="Ask about these files"]')).toBeNull()
  expectNoWrites()

  // Into the folder, then a file: it reads and downloads, and nothing saves it.
  const folder = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes('report'))!
  await act(async () => folder.click())
  const file = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes('scan.zip'))!
  await act(async () => file.click())
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
  expect(buttons()).toContain('Download')
  expect(buttons()).not.toContain('Summarize')
  expectNoWrites()
  expect(errors()).toHaveLength(0)
})

it('shows a teacher a review and its comments with no way to answer, comment or delete', async () => {
  vi.mocked(classBoardRepoId).mockResolvedValue('p')
  await show({ readOnly: true }, '/?tab=files&view=changes')
  // A teacher neither sent nor was asked to review it, so it sits under Other open requests.
  const others = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes('Other open requests'))!
  await act(async () => others.click())
  await act(async () => {})
  expect(page()).toContain('Add the method chapter')
  expect(page()).toContain('Looks right')
  expect(buttons()).not.toContain('Summarize this change')
  expectNoWrites()
  expect(errors()).toHaveLength(0)
})

it('shows a teacher every share in the group, to open or download only', async () => {
  vi.mocked(classBoardRepoId).mockResolvedValue('p')
  vi.mocked(listShares).mockResolvedValue([
    {
      id: 'sh1', project_id: 'p', repo_id: 'repo', sender_id: 's1', recipient_ids: ['s2'], type: 'file',
      path: 'notes.md', created_at: '2026-11-01T00:00:00Z',
      files: [{ path: 'notes.md', kind: 'text', content: 'Hi', storage_path: null }],
    },
  ] as never)
  await show({ readOnly: true, show: 'shared' })
  expect(page()).toContain('From s1 to s2')
  expect(page()).not.toContain('Nothing is shared')
  const menu = document.body.querySelector('[aria-label="Actions for notes.md"]') as HTMLButtonElement
  await act(async () => menu.click())
  const items = [...document.body.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent?.trim())
  expect(items).toEqual(['Open', 'Download'])
  expect(errors()).toHaveLength(0)
})

it('does not surface an error from the draft call a teacher is refused, even on a My workspace link', async () => {
  vi.mocked(classBoardRepoId).mockResolvedValue('p')
  // myDraft is mocked to raise, as my_general_draft does for a teacher.
  await show({ readOnly: true }, '/?tab=files&view=draft')
  expect(myDraft).not.toHaveBeenCalled()
  expect(errors()).toHaveLength(0)
  expect(page()).toContain('Project files')
  expect(page()).not.toContain('did not load')
})

it('still opens, and sets up, a student group files as before', async () => {
  vi.mocked(ensureClassBoardRepo).mockResolvedValue('p')
  const member = { ...loaded, me: { user_id: 's1' }, myRole: 'pm' } as unknown as GeneralProjectState
  vi.mocked(useGeneralProject).mockImplementation((id) => (id ? member : ({ ...member, project: null } as never)))
  vi.mocked(myDraft).mockResolvedValue({ id: 'draft' } as never)
  await show({ viewerId: 's1' })
  expect(ensureClassBoardRepo).toHaveBeenCalledWith('b1')
  expect(classBoardRepoId).not.toHaveBeenCalled()
  expect(myDraft).toHaveBeenCalledWith('repo')
  expect(page()).toContain('My workspace')
  expect(buttons()).toContain('New')
})
