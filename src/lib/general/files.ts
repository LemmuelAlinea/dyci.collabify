/**
 * Paths, folders and file kinds.
 *
 * A file's path is its identity and its folder both — `documents/Chapter 1.docx`
 * needs no folder record, it just has a `/` in it. Everything here is the pure
 * logic that turns a flat list of paths into a tree and decides what kind of
 * thing a file is, so the database and the interface agree without either one
 * asking the other.
 */
import { parseWorkbook, workbookToText } from './sheet'
import type { FileKind, GeneralTreeFile, RepoFile } from './types'

export const PATH_LIMIT = 400

/** Mirrors the general_blobs_path_shape check in supabase/general-repo.sql. */
export function pathProblem(path: string): string | null {
  const p = path.trim()
  if (!p) return 'Give the file a path, like documents/Chapter 1.docx.'
  if (p.length > PATH_LIMIT) return `A path can be up to ${PATH_LIMIT} characters.`
  if (p.startsWith('/')) return 'A path starts inside the project, so it cannot begin with a slash.'
  if (p.endsWith('/')) return 'That is a folder, not a file. Add a file name at the end.'
  if (p.includes('\\')) return 'Use forward slashes between folders.'
  if (/(^|\/)\.\.(\/|$)/.test(p)) return 'A path cannot climb out of the project with "..".'
  if (/\/\//.test(p)) return 'A path cannot have an empty folder in it.'
  return null
}

export function fileName(path: string) {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function folderOf(path: string) {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

export function extensionOf(path: string) {
  const name = fileName(path)
  const i = name.lastIndexOf('.')
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase()
}

export function pathWithPickedExtension(path: string, pickedName?: string | null) {
  const p = path.trim()
  const pickedExt = pickedName ? extensionOf(pickedName) : ''
  if (!p || extensionOf(p) || !pickedExt) return p
  return `${p}.${pickedExt}`
}

const RICH = new Set(['docx', 'doc', 'odt', 'rtf'])
const SHEET = new Set(['xlsx', 'xlsm', 'csv'])
const TEXT = new Set([
  'txt', 'md', 'markdown', 'ts', 'tsx', 'js', 'jsx', 'json', 'html', 'css', 'scss',
  'sql', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'php', 'rb', 'go', 'rs', 'sh', 'yml',
  'yaml', 'xml', 'env', 'gitignore', 'toml', 'ini', 'kt', 'swift', 'dart', 'vue',
])

/**
 * What the site will do with a file of this name.
 *
 * Anything it does not recognise is binary — kept, versioned and downloadable,
 * but not opened. Guessing wrong in that direction is safe; guessing that a
 * photograph is text is not.
 */
export function kindForPath(path: string): FileKind {
  const ext = extensionOf(path)
  if (RICH.has(ext)) return 'rich'
  if (SHEET.has(ext)) return 'sheet'
  if (TEXT.has(ext)) return 'text'
  // A file with no extension at all is usually a config file — README, LICENSE,
  // Dockerfile. Treating those as text is right far more often than not.
  if (ext === '') return 'text'
  return 'binary'
}

export function isEditable(kind: FileKind) {
  return kind !== 'binary'
}

export function looksLikeMisreadOfficeFile(content: string) {
  const sample = content.slice(0, 50000)
  return (
    sample.startsWith('PK') &&
    (sample.includes('[Content_Types].xml') ||
      sample.includes('word/document.xml') ||
      sample.includes('xl/workbook.xml'))
  )
}

/* ------------------------------------------------------------------- tree */

/** An empty folder made in the site holds one hidden file with this name. */
export const KEEP = '.keep'

export function isKeep(path: string) {
  return fileName(path) === KEEP
}

/**
 * The files a change or commit shows, without `.keep` placeholders. `folders`
 * names each folder a placeholder makes or removes that no shown file lives under.
 */
export function shownFiles<T extends { path: string }>(files: T[]) {
  const shown = files.filter((f) => !isKeep(f.path))
  const folders = [
    ...new Set(
      files
        .filter((f) => isKeep(f.path))
        .map((f) => folderOf(f.path))
        .filter((dir) => dir && !shown.some((s) => s.path.startsWith(`${dir}/`))),
    ),
  ]
  return { shown, folders }
}

/** "2 files, 1 folder", naming folders only when there are some. */
export function countShown(files: number, folders: number) {
  const fileWords = `${files} ${files === 1 ? 'file' : 'files'}`
  const folderWords = `${folders} ${folders === 1 ? 'folder' : 'folders'}`
  if (!folders) return fileWords
  return files ? `${fileWords}, ${folderWords}` : folderWords
}

export function joinPath(folder: string, name: string) {
  return folder ? `${folder}/${name}` : name
}

export type TreeNode =
  | { type: 'folder'; name: string; path: string; children: TreeNode[]; fileCount: number }
  | { type: 'file'; name: string; path: string; file: GeneralTreeFile }

/** Groups a flat list of files into folders, each sorted folders-first by name. */
export function buildTree(files: GeneralTreeFile[]): TreeNode[] {
  type Folder = { children: Map<string, Folder>; files: GeneralTreeFile[] }
  const root: Folder = { children: new Map(), files: [] }

  for (const f of files) {
    const parts = f.path.split('/')
    const name = parts.pop() as string
    let here = root
    for (const part of parts) {
      let next = here.children.get(part)
      if (!next) {
        next = { children: new Map(), files: [] }
        here.children.set(part, next)
      }
      here = next
    }
    void name
    here.files.push(f)
  }

  const build = (folder: Folder, prefix: string): TreeNode[] => {
    const folders: TreeNode[] = [...folder.children.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, child]) => {
        const path = prefix ? `${prefix}/${name}` : name
        const children = build(child, path)
        return {
          type: 'folder' as const,
          name,
          path,
          children,
          fileCount: countFiles(children),
        }
      })
    const leaves: TreeNode[] = folder.files
      .filter((f) => !isKeep(f.path))
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((f) => ({ type: 'file' as const, name: fileName(f.path), path: f.path, file: f }))
    return [...folders, ...leaves]
  }

  return build(root, '')
}

export function countFiles(nodes: TreeNode[]): number {
  return nodes.reduce((n, node) => n + (node.type === 'file' ? 1 : countFiles(node.children)), 0)
}

export function folderNameProblem(name: string, siblings: string[]): string | null {
  const n = name.trim()
  if (!n) return 'Give the folder a name.'
  if (n.length > 120) return 'A folder name can be up to 120 characters.'
  if (n.includes('/') || n.includes('\\')) return 'A folder name cannot have a slash in it.'
  if (n === '.' || n === '..') return 'Pick a name other than "." or "..".'
  if (siblings.some((s) => s.toLowerCase() === n.toLowerCase())) {
    return `A folder called ${n} is already here. Pick another name.`
  }
  return null
}

export function nodesAt(nodes: TreeNode[], path: string): TreeNode[] | null {
  if (!path) return nodes
  let here = nodes
  for (const part of path.split('/')) {
    const next = here.find((n) => n.type === 'folder' && n.name === part)
    if (!next || next.type !== 'folder') return null
    here = next.children
  }
  return here
}

export function crumbs(path: string) {
  if (!path) return []
  const parts = path.split('/')
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }))
}

export function flatFiles(nodes: TreeNode[]): Extract<TreeNode, { type: 'file' }>[] {
  return nodes.flatMap((n) => (n.type === 'file' ? [n] : flatFiles(n.children)))
}

/** Every folder in the tree, as paths, so a picker can offer them. */
export function foldersIn(files: { path: string }[]) {
  const out = new Set<string>()
  for (const f of files) {
    const parts = f.path.split('/')
    parts.pop()
    let prefix = ''
    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part
      out.add(prefix)
    }
  }
  return [...out].sort()
}

/* ------------------------------------------------------------------ drafts */

/**
 * What a draft would do to Main, in the words a person would use.
 *
 * "1 file added, 2 changed" rather than a count, because the three actions are
 * not equally reversible and a reviewer reads the removals first.
 */
export function describeDraft(files: Pick<RepoFile, 'action' | 'path'>[]) {
  const counted = files.filter((f) => !isKeep(f.path))
  if (counted.length === 0) return 'Nothing changed yet'
  const n = { added: 0, changed: 0, removed: 0 }
  for (const f of counted) n[f.action]++
  const parts: string[] = []
  if (n.added) parts.push(`${n.added} added`)
  if (n.changed) parts.push(`${n.changed} changed`)
  if (n.removed) parts.push(`${n.removed} removed`)
  const word = counted.length === 1 ? 'file' : 'files'
  return `${counted.length} ${word}: ${parts.join(', ')}`
}

/**
 * What saving this file into a draft would mean for Main.
 *
 * A path Main does not have is an addition; one it has is a change. Working it
 * out here rather than asking the caller means a draft cannot claim to add a
 * file that already exists, which the database would refuse at merge time.
 */
export function actionFor(path: string, tree: { path: string }[]) {
  return tree.some((f) => f.path === path) ? 'changed' : 'added'
}

/* ---------------------------------------------------------------- reading */

const BLOCK = /<\/?(p|div|h[1-6]|li|tr|br|blockquote|section|article|table|thead|tbody)\b[^>]*>/gi
const ENTITY: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
}

/**
 * A file as the text a person should be shown when comparing two versions.
 *
 * Without this a reviewer deciding whether to accept somebody's chapter is
 * handed `<h1>Chapter 1</h1><p>The problem…`, and a budget arrives as a line of
 * JSON. What is stored and what is read are not the same thing, and the diff
 * belongs to the reader.
 *
 * Deliberately regex rather than DOMParser: this runs in the same pure layer
 * the tests do, and a diff that is slightly rough on exotic markup is a far
 * smaller problem than a diff nobody can read.
 */
export function fileText(kind: FileKind, content: string): string {
  if (kind === 'binary') return ''
  if (kind === 'text') return content
  if (kind === 'sheet') return workbookToText(parseWorkbook(content))
  return content
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(h[1-6]|p|li|tr|blockquote)>/gi, '\n')
    .replace(BLOCK, '\n')
    .replace(/<\/(td|th)>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITY[e.toLowerCase()] ?? e)
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, '').trimStart())
    .join('\n')
    // Adjacent tags each contribute a break, so a list arrives full of blank
    // lines. A line diff reads better without them.
    .replace(/\n{2,}/g, '\n')
    .trim()
}
