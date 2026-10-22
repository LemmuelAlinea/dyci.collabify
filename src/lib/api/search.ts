import { supabase } from '../supabase'
import { fileName, folderOf, isKeep } from '../general/files'
import { paths } from '../paths'

/**
 * Search across the things too numerous to load up front: tasks, files and
 * meetings. Every query goes through the caller's own row-level security, so a
 * result is only ever something the reader could already open — a professor
 * finds no group's files, a student no other board's tasks.
 */

export type SearchHit = {
  key: string
  label: string
  detail: string
  to: string
}

export type SearchHits = {
  tasks: SearchHit[]
  files: SearchHit[]
  meetings: SearchHit[]
}

/** Per kind. The box shows fewer; the rest is headroom for de-duplicating. */
const LIMIT = 12

/** `%` and `_` are wildcards to ilike; a typed one should match itself. */
function contains(query: string) {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

type Named = { title?: string; name?: string; archived_at: string | null; trashed_at?: string | null }
/** PostgREST hands a to-one embed back as an object, but types it loosely. */
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))
const live = (p: Named | null) => Boolean(p && !p.archived_at && !p.trashed_at)

const classTaskLink = (projectId: string, taskId: string) =>
  `${paths.classProject(projectId)}?tab=work&task=${taskId}`
const workTaskLink = (projectId: string, taskId: string) => `${paths.project(projectId)}?tab=work&task=${taskId}`
const filesLink = (base: string, path: string) => {
  const folder = folderOf(path)
  return `${base}?tab=files${folder ? `&path=${encodeURIComponent(folder)}` : ''}`
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

type BoardEmbed = { project_id: string; projects: Named | Named[] | null }

async function classTasks(like: string): Promise<SearchHit[]> {
  const { data, error } = await supabase
    .from('project_tasks')
    .select('id, origin_id, title, project_boards(project_id, projects(title, archived_at, trashed_at))')
    .ilike('title', like)
    .is('archived_at', null)
    .is('trashed_at', null)
    .order('updated_at', { ascending: false })
    .limit(LIMIT * 3)
  if (error) throw error
  // A task a professor set is copied onto every board; show it once per project.
  const seen = new Set<string>()
  const hits: SearchHit[] = []
  for (const t of data ?? []) {
    const board = one(t.project_boards as BoardEmbed | BoardEmbed[] | null)
    const project = one(board?.projects)
    if (!board || !live(project)) continue
    const key = `${board.project_id}:${t.origin_id ?? t.id}`
    if (seen.has(key)) continue
    seen.add(key)
    hits.push({
      key: `class-task:${t.id}`,
      label: t.title,
      detail: `Task · ${project!.title}`,
      to: classTaskLink(board.project_id, t.id),
    })
  }
  return hits.slice(0, LIMIT)
}

async function workTasks(like: string): Promise<SearchHit[]> {
  const { data, error } = await supabase
    .from('general_tasks')
    .select('id, title, project_id, general_projects(name, class_board_id, archived_at, trashed_at)')
    .ilike('title', like)
    .is('archived_at', null)
    .is('trashed_at', null)
    .order('updated_at', { ascending: false })
    .limit(LIMIT)
  if (error) throw error
  return (data ?? []).flatMap((t) => {
    type ProjectEmbed = Named & { class_board_id: string | null }
    const project = one(t.general_projects as unknown as ProjectEmbed | ProjectEmbed[] | null)
    if (!live(project) || project!.class_board_id) return []
    return [{ key: `work-task:${t.id}`, label: t.title, detail: `Task · ${project!.name}`, to: workTaskLink(t.project_id, t.id) }]
  })
}

/**
 * Files in Main. A repository keeps every version of a file as its own row, so
 * the latest row per path decides whether the file is there now; one whose
 * latest change removed it is not.
 */
async function mainFiles(query: string, like: string): Promise<SearchHit[]> {
  const { data, error } = await supabase
    .from('general_blobs')
    .select('repo_id, project_id, path, action, seq')
    .ilike('path', like)
    .order('seq', { ascending: false })
    .limit(300)
  if (error) throw error

  const latest = new Map<string, { project_id: string; path: string; action: string }>()
  for (const b of data ?? []) {
    const key = `${b.repo_id}:${b.path}`
    if (!latest.has(key)) latest.set(key, b)
  }
  const needle = query.toLowerCase()
  const current = [...latest.values()].filter(
    (b) => b.action !== 'removed' && !isKeep(b.path) && fileName(b.path).toLowerCase().includes(needle),
  )
  if (current.length === 0) return []

  // Which project each file lives in. A group board's files sit in a hidden
  // work project tied to the board; they open on the class project's Files.
  const projectIds = [...new Set(current.map((b) => b.project_id))]
  const { data: projects, error: pErr } = await supabase
    .from('general_projects')
    .select('id, name, class_board_id, archived_at, trashed_at')
    .in('id', projectIds)
  if (pErr) throw pErr
  const byId = new Map((projects ?? []).map((p) => [p.id, p]))

  const boardIds = (projects ?? []).flatMap((p) => (p.class_board_id ? [p.class_board_id] : []))
  const boards = new Map<string, { project_id: string; title: string }>()
  if (boardIds.length > 0) {
    const { data: rows, error: bErr } = await supabase
      .from('project_boards')
      .select('id, project_id, projects(title, archived_at, trashed_at)')
      .in('id', boardIds)
    if (bErr) throw bErr
    for (const r of rows ?? []) {
      const project = one(r.projects as Named | Named[] | null)
      if (live(project)) boards.set(r.id, { project_id: r.project_id, title: project!.title! })
    }
  }

  return current.flatMap((b) => {
    const project = byId.get(b.project_id)
    if (!project || !live(project)) return []
    const board = project.class_board_id ? boards.get(project.class_board_id) : null
    if (project.class_board_id && !board) return []
    const where = board ? board.title : project.name
    const folder = folderOf(b.path)
    const base = board ? paths.classProject(board.project_id) : paths.project(project.id)
    return [{ key: `main:${b.project_id}:${b.path}`, label: fileName(b.path), detail: `File · ${where}${folder ? ` · ${folder}` : ''}`, to: filesLink(base, b.path) }]
  }).slice(0, LIMIT)
}

/** A class project's own brief files, shown on its Brief tab. */
async function briefFiles(like: string): Promise<SearchHit[]> {
  const { data, error } = await supabase
    .from('project_attachments')
    .select('id, file_name, project_id, projects(title, archived_at, trashed_at)')
    .ilike('file_name', like)
    .limit(LIMIT)
  if (error) throw error
  return (data ?? []).flatMap((f) => {
    const project = one(f.projects as Named | Named[] | null)
    if (!live(project)) return []
    return [{ key: `brief:${f.id}`, label: f.file_name, detail: `File · ${project!.title} · brief`, to: paths.classProject(f.project_id) }]
  })
}

/** Files attached to a task, class or work; they open the task. */
async function taskFiles(like: string): Promise<SearchHit[]> {
  const [classRes, workRes] = await Promise.all([
    supabase
      .from('task_files')
      .select('id, file_name, task_id, project_tasks(title, archived_at, trashed_at, project_boards(project_id, projects(title, archived_at, trashed_at)))')
      .ilike('file_name', like)
      .limit(LIMIT),
    supabase
      .from('general_task_files')
      .select('id, file_name, task_id, project_id, general_tasks(title, archived_at, trashed_at, general_projects(name, archived_at, trashed_at))')
      .ilike('file_name', like)
      .is('archived_at', null)
      .is('trashed_at', null)
      .limit(LIMIT),
  ])
  if (classRes.error) throw classRes.error
  if (workRes.error) throw workRes.error

  type TaskEmbed = Named & { project_boards: BoardEmbed | BoardEmbed[] | null }
  const fromClass = (classRes.data ?? []).flatMap((f) => {
    const task = one(f.project_tasks as TaskEmbed | TaskEmbed[] | null)
    const board = one(task?.project_boards)
    const project = one(board?.projects)
    if (!task || !live(task) || !board || !live(project)) return []
    return [{ key: `class-task-file:${f.id}`, label: f.file_name, detail: `File · ${task.title}`, to: classTaskLink(board.project_id, f.task_id) }]
  })
  type WorkTaskEmbed = Named & { general_projects: Named | Named[] | null }
  const fromWork = (workRes.data ?? []).flatMap((f) => {
    const task = one(f.general_tasks as WorkTaskEmbed | WorkTaskEmbed[] | null)
    const project = one(task?.general_projects)
    if (!live(task) || !live(project)) return []
    return [{ key: `work-task-file:${f.id}`, label: f.file_name, detail: `File · ${task!.title}`, to: workTaskLink(f.project_id, f.task_id) }]
  })
  return [...fromClass, ...fromWork]
}

async function meetings(like: string): Promise<SearchHit[]> {
  const { data, error } = await supabase
    .from('meetings')
    .select('id, title, starts_at')
    .ilike('title', like)
    .is('cancelled_at', null)
    .order('starts_at', { ascending: false })
    .limit(LIMIT)
  if (error) throw error
  return (data ?? []).map((m) => ({
    key: `meeting:${m.id}`,
    label: m.title,
    detail: `Meeting · ${when(m.starts_at)}`,
    to: `${paths.meetings}?meeting=${m.id}`,
  }))
}

/** Two characters at least: one letter matches nearly everything. */
export const SEARCH_MIN = 2

export async function searchWorkspace(query: string): Promise<SearchHits> {
  const q = query.trim()
  if (q.length < SEARCH_MIN) return { tasks: [], files: [], meetings: [] }
  const like = contains(q)
  const [ct, wt, main, brief, attached, meets] = await Promise.all([
    classTasks(like),
    workTasks(like),
    mainFiles(q, like),
    briefFiles(like),
    taskFiles(like),
    meetings(like),
  ])
  return { tasks: [...ct, ...wt], files: [...main, ...brief, ...attached], meetings: meets }
}
