import { describe, expect, it } from 'vitest'
import {
  actionFor,
  buildTree,
  describeDraft,
  extensionOf,
  fileName,
  folderOf,
  foldersIn,
  isEditable,
  kindForPath,
  pathProblem,
} from './files'
import type { GeneralTreeFile } from './types'

/**
 * `pathProblem` has to agree with the general_blobs_path_shape check in the
 * database. Where it does not, somebody types a path, gets no warning, and is
 * refused by a constraint message on save — which is the shape of the worst
 * defect this codebase has had.
 */

function file(path: string): GeneralTreeFile {
  return {
    id: path,
    repo_id: 'r',
    project_id: 'p',
    commit_id: 'c',
    seq: 1,
    path,
    kind: 'text',
    content: '',
    storage_path: null,
    size: 0,
    created_at: '2026-09-19T00:00:00Z',
  }
}

describe('pathProblem', () => {
  it('accepts an ordinary path', () => {
    expect(pathProblem('documents/Chapter 1.docx')).toBeNull()
    expect(pathProblem('README.md')).toBeNull()
    expect(pathProblem('src/lib/general/files.ts')).toBeNull()
  })

  it('refuses everything the database refuses', () => {
    expect(pathProblem('/etc/passwd')).toContain('slash')
    expect(pathProblem('src/')).toContain('folder')
    expect(pathProblem('src\\app.ts')).toContain('forward slashes')
    expect(pathProblem('../secrets')).toContain('climb out')
    expect(pathProblem('a/../../b')).toContain('climb out')
    expect(pathProblem('src//app.ts')).toContain('empty folder')
    expect(pathProblem('   ')).toContain('Give the file a path')
  })

  it('does not mistake two dots inside a name for climbing out', () => {
    expect(pathProblem('docs/notes..md')).toBeNull()
    expect(pathProblem('..hidden')).toBeNull()
  })

  it('holds the length the column holds', () => {
    expect(pathProblem('a'.repeat(400))).toBeNull()
    expect(pathProblem('a'.repeat(401))).toContain('400')
  })
})

describe('naming', () => {
  it('splits a path into its folder and its name', () => {
    expect(fileName('documents/Chapter 1.docx')).toBe('Chapter 1.docx')
    expect(folderOf('documents/Chapter 1.docx')).toBe('documents')
    expect(fileName('README.md')).toBe('README.md')
    expect(folderOf('README.md')).toBe('')
  })

  it('reads an extension without being fooled by a dotfile', () => {
    expect(extensionOf('a/b.TS')).toBe('ts')
    expect(extensionOf('.gitignore')).toBe('')
    expect(extensionOf('Dockerfile')).toBe('')
    expect(extensionOf('archive.tar.gz')).toBe('gz')
  })
})

describe('kindForPath', () => {
  it('sends Word and Excel to their editors', () => {
    expect(kindForPath('documents/Chapter 1.docx')).toBe('rich')
    expect(kindForPath('Budget.XLSX')).toBe('sheet')
    expect(kindForPath('data.csv')).toBe('sheet')
  })

  it('treats code and notes as text', () => {
    expect(kindForPath('src/app.ts')).toBe('text')
    expect(kindForPath('notes.md')).toBe('text')
    expect(kindForPath('Dockerfile')).toBe('text')
  })

  it('leaves anything it does not know alone', () => {
    expect(kindForPath('scan.pdf')).toBe('binary')
    expect(kindForPath('photo.jpg')).toBe('binary')
    expect(kindForPath('slides.pptx')).toBe('binary')
    expect(isEditable('binary')).toBe(false)
    expect(isEditable('rich')).toBe(true)
  })
})

describe('buildTree', () => {
  it('turns paths into folders, folders before files', () => {
    const tree = buildTree([
      file('README.md'),
      file('src/app.ts'),
      file('documents/Chapter 1.md'),
      file('documents/notes/aside.md'),
    ])
    expect(tree.map((n) => n.name)).toEqual(['documents', 'src', 'README.md'])
    const docs = tree[0]
    expect(docs.type).toBe('folder')
    if (docs.type !== 'folder') return
    expect(docs.children.map((n) => n.name)).toEqual(['notes', 'Chapter 1.md'])
    expect(docs.fileCount).toBe(2)
  })

  it('gives a folder its full path, not just its name', () => {
    const tree = buildTree([file('a/b/c.txt')])
    const a = tree[0]
    if (a.type !== 'folder') throw new Error('expected a folder')
    const b = a.children[0]
    expect(b.path).toBe('a/b')
  })

  it('handles an empty project', () => {
    expect(buildTree([])).toEqual([])
  })

  it('lists every folder a picker could offer', () => {
    expect(foldersIn([{ path: 'a/b/c.txt' }, { path: 'a/d.txt' }, { path: 'e.txt' }])).toEqual([
      'a',
      'a/b',
    ])
  })
})

describe('describeDraft', () => {
  it('says what a draft would do, not just how much', () => {
    expect(describeDraft([])).toBe('Nothing changed yet')
    expect(describeDraft([{ action: 'added' }])).toBe('1 file: 1 added')
    expect(
      describeDraft([{ action: 'added' }, { action: 'changed' }, { action: 'removed' }]),
    ).toBe('3 files: 1 added, 1 changed, 1 removed')
  })
})

describe('actionFor', () => {
  it('calls a path Main already has a change, and a new one an addition', () => {
    const tree = [{ path: 'README.md' }]
    expect(actionFor('README.md', tree)).toBe('changed')
    expect(actionFor('CHANGELOG.md', tree)).toBe('added')
  })
})
