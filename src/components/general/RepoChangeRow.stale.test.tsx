// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { RepoChangeRow } from './RepoChangeRow'
import type { GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const m = vi.hoisted(() => ({ toast: vi.fn(), answer: vi.fn() }))

vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: m.toast }) }))
vi.mock('./WordDiff', () => ({ WordDiff: () => null }))
vi.mock('../../lib/api/workAi', () => ({ summarizeChange: vi.fn() }))
vi.mock('../../lib/api/general', () => ({
  addRepoComment: vi.fn(),
  answerRepoChange: m.answer,
  contentAt: vi.fn(async () => ''),
  storagePathAt: vi.fn(),
  deleteRepoComment: vi.fn(),
  listRepoComments: vi.fn(async () => []),
  projectFileUrl: vi.fn(),
  restoreRepoChange: vi.fn(),
  withdrawRepoChange: vi.fn(),
}))

const repo = { id: 'repo', name: 'Files', file_count: 1, commit_count: 6, last_author: null, last_commit_at: null }
const state = {
  project: { id: 'p', class_board_id: null },
  myRole: 'pm',
  readOnly: false,
  classTeacher: true, // keeps the AI summary out of this test
  viewerId: 'me',
  can: () => true,
  nameOf: (id: string) => (id === 'ana' ? 'Ana' : 'A former member'),
} as unknown as GeneralProjectState

const change = {
  id: 'c',
  repo_id: 'repo',
  project_id: 'p',
  author_id: 'ana',
  title: 'Chapter 2',
  body: '',
  status: 'open',
  base_seq: 6,
  reviewer_id: null,
  reviewer_ids: [],
  decided_by: null,
  decided_note: null,
  created_at: '2026-11-15T00:00:00Z',
  files: [{ path: 'notes.txt', action: 'changed', kind: 'text', content: 'x', storage_path: null }],
}

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = null
  root = null
  vi.clearAllMocks()
})

it("names the change's author when a merge is held, not the reviewer", async () => {
  m.answer.mockRejectedValue({
    message:
      'Main has a newer version of Chap1-4.docx than the copy this was made from. Get the newer version, combine the two in Word, then upload again.',
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(<RepoChangeRow change={change as never} repo={repo as never} state={state} onDone={async () => {}} />),
  )
  const merge = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Merge')!
  await act(async () => merge.click())
  expect(m.toast).toHaveBeenCalledWith(
    'Main has a newer version of Chap1-4.docx than the copy Ana started from. Ana has to get the newer version, combine the two in Word and upload again.',
    'error',
  )
})
