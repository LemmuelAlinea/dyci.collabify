import { describe, expect, it } from 'vitest'
import {
  actionFor,
  buildTree,
  describeDraft,
  extensionOf,
  fileText,
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

describe('fileText', () => {
  it('leaves plain text and code alone', () => {
    expect(fileText('text', 'const a = 1\nconst b = 2')).toBe('const a = 1\nconst b = 2')
  })

  it('reads a document as its words, not its markup', () => {
    expect(
      fileText('rich', '<h1>Chapter 1</h1><p>The problem.</p><ul><li>One</li><li>Two</li></ul>'),
    ).toBe('Chapter 1\nThe problem.\nOne\nTwo')
  })

  it('keeps emphasis out of the way rather than showing its tags', () => {
    expect(fileText('rich', '<p>The <strong>main</strong> point</p>')).toBe('The main point')
  })

  it('turns a line break into a line', () => {
    expect(fileText('rich', '<p>One<br>Two</p>')).toBe('One\nTwo')
  })

  it('decodes the entities a document editor produces', () => {
    expect(fileText('rich', '<p>Tom &amp; Jerry &lt;here&gt;&nbsp;now</p>')).toBe(
      'Tom & Jerry <here> now',
    )
  })

  it('lays a table out by row', () => {
    expect(fileText('rich', '<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>')).toBe(
      'a\tb\nc',
    )
  })

  it('drops a script rather than diffing its source', () => {
    expect(fileText('rich', '<p>Safe</p><script>alert(1)</script>')).toBe('Safe')
  })

  it('reads a spreadsheet as its cells, not as JSON', () => {
    const stored = JSON.stringify({
      sheets: [{ name: 'Budget', rows: [['Item', 'Cost'], ['Tarpaulin', '1500']] }],
    })
    expect(fileText('sheet', stored)).toBe('# Budget\nItem\tCost\nTarpaulin\t1500')
  })

  it('has nothing to show for a file it cannot open', () => {
    expect(fileText('binary', '')).toBe('')
  })
})
