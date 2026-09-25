import { describe, expect, it } from 'vitest'
import {
  actionFor,
  buildTree,
  crumbs,
  describeDraft,
  extensionOf,
  fileText,
  fileName,
  flatFiles,
  folderNameProblem,
  folderOf,
  foldersIn,
  isEditable,
  isKeep,
  joinPath,
  kindForPath,
  looksLikeMisreadOfficeFile,
  nodesAt,
  pathWithPickedExtension,
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

  it('keeps an uploaded file extension when the typed path has none', () => {
    expect(pathWithPickedExtension('documents/Chapter 1 and 2', 'Chapt1-2.docx')).toBe(
      'documents/Chapter 1 and 2.docx',
    )
    expect(pathWithPickedExtension('documents/notes.md', 'Chapt1-2.docx')).toBe('documents/notes.md')
  })
})

describe('kindForPath', () => {
  it('sends Word and Excel to their editors', () => {
    expect(kindForPath('documents/Chapter 1.docx')).toBe('rich')
    expect(kindForPath('Budget.XLSX')).toBe('sheet')
    expect(kindForPath('Budget.XLSM')).toBe('sheet')
    expect(kindForPath('data.csv')).toBe('sheet')
  })

  it('treats code and notes as text', () => {
    expect(kindForPath('src/app.ts')).toBe('text')
    expect(kindForPath('notes.md')).toBe('text')
    expect(kindForPath('Dockerfile')).toBe('text')
  })

  it('leaves anything it does not know alone', () => {
    expect(kindForPath('scan.pdf')).toBe('binary')
    expect(kindForPath('legacy.xls')).toBe('binary')
    expect(kindForPath('photo.jpg')).toBe('binary')
    expect(kindForPath('slides.pptx')).toBe('binary')
    expect(isEditable('binary')).toBe(false)
    expect(isEditable('rich')).toBe(true)
  })
})

describe('looksLikeMisreadOfficeFile', () => {
  it('spots office zips that were stored as text', () => {
    expect(looksLikeMisreadOfficeFile('PK!\u0000[Content_Types].xml word/document.xml')).toBe(true)
    expect(looksLikeMisreadOfficeFile('ordinary project notes')).toBe(false)
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
    expect(describeDraft([{ path: 'a.txt', action: 'added' }])).toBe('1 file: 1 added')
    expect(
      describeDraft([
        { path: 'a.txt', action: 'added' },
        { path: 'b.txt', action: 'changed' },
        { path: 'c.txt', action: 'removed' },
      ]),
    ).toBe('3 files: 1 added, 1 changed, 1 removed')
  })

  it('never counts the hidden empty-folder placeholder', () => {
    const withKeep = [
      { path: 'Figures/.keep', action: 'added' as const },
      { path: 'a.txt', action: 'changed' as const },
    ]
    const withoutKeep = [{ path: 'a.txt', action: 'changed' as const }]
    expect(describeDraft(withKeep)).toBe(describeDraft(withoutKeep))
    expect(describeDraft(withKeep)).toBe('1 file: 1 changed')
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

describe('site-made folders', () => {
  const tree = buildTree([file('Chapter 1/.keep'), file('Chapter 2/intro.md'), file('Chapter 2/Figures/.keep'), file('readme.md')])

  it('shows a folder that holds only .keep, empty', () => {
    const ch1 = tree.find((n) => n.name === 'Chapter 1')
    expect(ch1?.type).toBe('folder')
    expect(ch1?.type === 'folder' && ch1.children).toEqual([])
    expect(ch1?.type === 'folder' && ch1.fileCount).toBe(0)
  })

  it('never lists or counts .keep', () => {
    expect(flatFiles(tree).map((f) => f.path)).toEqual(['Chapter 2/intro.md', 'readme.md'])
    expect(isKeep('a/b/.keep')).toBe(true)
    expect(isKeep('a/keep.md')).toBe(false)
  })

  it('finds the children of a folder by path', () => {
    expect(nodesAt(tree, '')).toBe(tree)
    expect(nodesAt(tree, 'Chapter 2')?.map((n) => n.name)).toEqual(['Figures', 'intro.md'])
    expect(nodesAt(tree, 'Chapter 2/Figures')).toEqual([])
    expect(nodesAt(tree, 'Nope')).toBeNull()
    expect(nodesAt(tree, 'readme.md')).toBeNull()
  })

  it('builds breadcrumbs from a path', () => {
    expect(crumbs('')).toEqual([])
    expect(crumbs('a/b')).toEqual([
      { name: 'a', path: 'a' },
      { name: 'b', path: 'a/b' },
    ])
  })

  it('joins a folder and a name', () => {
    expect(joinPath('', 'x')).toBe('x')
    expect(joinPath('a/b', 'x')).toBe('a/b/x')
  })

  it('checks a folder name against its neighbours', () => {
    expect(folderNameProblem('  ', [])).toBe('Give the folder a name.')
    expect(folderNameProblem('a'.repeat(121), [])).toBe('A folder name can be up to 120 characters.')
    expect(folderNameProblem('a/b', [])).toBe('A folder name cannot have a slash in it.')
    expect(folderNameProblem('..', [])).toBe('Pick a name other than "." or "..".')
    expect(folderNameProblem('figures', ['Figures'])).toBe('A folder called figures is already here. Pick another name.')
    expect(folderNameProblem('Tables', ['Figures'])).toBeNull()
  })
})
