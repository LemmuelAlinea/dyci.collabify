import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpcCalls: { name: string; args: unknown }[] = []
const eqs: [string, unknown][] = []
let result: { data: unknown; error: unknown } = { data: null, error: null }

vi.mock('../supabase', () => {
  const chain = () => {
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.eq = (c: string, v: unknown) => (eqs.push([c, v]), q)
    q.order = () => q
    q.then = (ok: (r: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad)
    return q
  }
  return {
    supabase: {
      from: () => chain(),
      rpc: (name: string, args: unknown) => (rpcCalls.push({ name, args }), Promise.resolve(result)),
    },
  }
})
vi.mock('./general', () => ({ copyProjectFile: vi.fn(), saveDraftFile: vi.fn() }))
vi.mock('./filePulls', () => ({ recordBase: vi.fn(), mainSeq: vi.fn() }))

import { copyProjectFile, saveDraftFile } from './general'
import { mainSeq, recordBase } from './filePulls'
import { commitOrigins, fileVersions, restoreFile, restoreToDraft, revertCommit } from './fileHistory'

const base = { repoId: 'r', projectId: 'p', path: 'a.bin' }
const ver = (over = {}) => ({
  seq: 3,
  action: 'changed' as const,
  kind: 'binary' as const,
  content: '',
  storage_path: 'p/files/x-a.bin',
  ...over,
})

beforeEach(() => {
  rpcCalls.length = 0
  eqs.length = 0
  result = { data: null, error: null }
  vi.clearAllMocks()
})

describe('restoreToDraft', () => {
  it('copies a binary and records Main seq', async () => {
    vi.mocked(copyProjectFile).mockResolvedValue('p/files/new-a.bin')
    vi.mocked(mainSeq).mockResolvedValue(9)
    await restoreToDraft({ ...base, target: ver(), mainHas: true })
    expect(copyProjectFile).toHaveBeenCalledWith('p', 'p/files/x-a.bin')
    expect(saveDraftFile).toHaveBeenCalledWith({
      repoId: 'r',
      path: 'a.bin',
      action: 'changed',
      kind: 'binary',
      storagePath: 'p/files/new-a.bin',
    })
    expect(recordBase).toHaveBeenCalledWith('r', 'a.bin', 'p/files/new-a.bin', 9)
  })
  it('saves text straight with content', async () => {
    await restoreToDraft({
      ...base,
      path: 'a.md',
      target: ver({ kind: 'text', content: 'hi', storage_path: null }),
      mainHas: false,
    })
    expect(copyProjectFile).not.toHaveBeenCalled()
    expect(saveDraftFile).toHaveBeenCalledWith({
      repoId: 'r',
      path: 'a.md',
      action: 'added',
      kind: 'text',
      content: 'hi',
    })
    expect(recordBase).not.toHaveBeenCalled()
  })
  it('saves removed for a null target', async () => {
    await restoreToDraft({ ...base, target: null, mainHas: true })
    expect(saveDraftFile).toHaveBeenCalledWith(expect.objectContaining({ action: 'removed' }))
  })
})

describe('rpc wrappers', () => {
  it('revertCommit passes p_path null when absent', async () => {
    result = { data: { id: 'c' }, error: null }
    await revertCommit('c1', 4)
    expect(rpcCalls[0]).toEqual({
      name: 'revert_general_commit',
      args: { p_commit: 'c1', p_base_seq: 4, p_path: null, p_message: '' },
    })
  })
  it('restoreFile calls the rpc', async () => {
    result = { data: { id: 'c' }, error: null }
    await restoreFile('r', 'a.md', 2, 4, 'm')
    expect(rpcCalls[0].args).toEqual({ p_repo: 'r', p_path: 'a.md', p_seq: 2, p_base_seq: 4, p_message: 'm' })
  })
  it('throws the rpc error', async () => {
    result = { data: null, error: new Error('boom') }
    await expect(revertCommit('c1', 4)).rejects.toThrow('boom')
  })
})

describe('reads', () => {
  it('fileVersions filters by repo and path and renames the embed', async () => {
    result = { data: [{ seq: 1, general_commits: { id: 'c' } }], error: null }
    const v = await fileVersions('r', 'a.md')
    expect(eqs).toEqual([
      ['repo_id', 'r'],
      ['path', 'a.md'],
    ])
    expect(v[0].commit).toEqual({ id: 'c' })
  })
  it('commitOrigins keys by commit id and drops the join', async () => {
    result = { data: [{ commit_id: 'c1', kind: 'revert', general_commits: { repo_id: 'r' } }], error: null }
    const o = await commitOrigins('r')
    expect(o.c1.kind).toBe('revert')
    expect('general_commits' in o.c1).toBe(false)
    expect(eqs).toEqual([['general_commits.repo_id', 'r']])
  })
})
