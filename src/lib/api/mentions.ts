import { supabase } from '../supabase'
import { paths } from '../paths'
import { mentionKey, type MentionKind, type MentionRef } from '../mentions'

/** A task or project the writer can mention (search_mentionables). */
export type Mentionable = {
  kind: MentionKind
  id: string
  title: string
  project_id: string
  project_title: string
}

/** How many people in the chat would see a mention locked (mention_blind_spots). Counts only, never a title. */
export type BlindSpot = {
  kind: MentionKind
  id: string
  members_without: number
  private_task: boolean
}

export type ResolvedMention =
  | { state: 'open'; title: string; href: string; archived: boolean }
  | { state: 'locked' }

export async function searchMentionables(query: string, conversationId: string): Promise<Mentionable[]> {
  const { data, error } = await supabase.rpc('search_mentionables', { p_query: query, p_conversation: conversationId })
  if (error) throw error
  return (data ?? []) as Mentionable[]
}

export async function mentionBlindSpots(conversationId: string, refs: MentionRef[]): Promise<BlindSpot[]> {
  const { data, error } = await supabase.rpc('mention_blind_spots', {
    p_conversation: conversationId,
    p_refs: refs.map((r) => ({ kind: r.kind, id: r.id })),
  })
  if (error) throw error
  return (data ?? []) as BlindSpot[]
}

type Board = { project_id: string } | { project_id: string }[] | null
const boardProject = (b: Board) => (Array.isArray(b) ? b[0]?.project_id : b?.project_id)

/**
 * What each mention is for this reader, read under their own access. A ref
 * that comes back empty is locked: the reader can't open it, or it is gone,
 * and the two are never told apart. A kind whose read fails is left out, and
 * shows as locked until it resolves.
 */
export async function resolveMentions(refs: MentionRef[]): Promise<Map<string, ResolvedMention>> {
  const out = new Map<string, ResolvedMention>()
  const ids = (kind: MentionKind) => [...new Set(refs.filter((r) => r.kind === kind).map((r) => r.id))]
  const open = (kind: MentionKind, id: string, title: string, href: string, archived: string | null) =>
    out.set(mentionKey({ kind, id }), { state: 'open', title, href, archived: archived !== null })

  const reads: Promise<void>[] = []
  const read = <T,>(kind: MentionKind, run: (wanted: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>, take: (rows: T[]) => void) => {
    const wanted = ids(kind)
    if (wanted.length === 0) return
    reads.push(
      Promise.resolve(run(wanted)).then(({ data, error }) => {
        if (error) return
        take(data ?? [])
        for (const id of wanted) if (!out.has(mentionKey({ kind, id }))) out.set(mentionKey({ kind, id }), { state: 'locked' })
      }, () => undefined),
    )
  }

  read<{ id: string; title: string; project_id: string; archived_at: string | null }>(
    't',
    (w) => supabase.from('general_tasks').select('id, title, project_id, archived_at').in('id', w),
    (rows) => rows.forEach((r) => open('t', r.id, r.title, `${paths.project(r.project_id)}?task=${r.id}`, r.archived_at)),
  )
  read<{ id: string; name: string; archived_at: string | null }>(
    'p',
    (w) => supabase.from('general_projects').select('id, name, archived_at').in('id', w),
    (rows) => rows.forEach((r) => open('p', r.id, r.name, paths.project(r.id), r.archived_at)),
  )
  read<{ id: string; title: string; archived_at: string | null; board: Board }>(
    'ct',
    (w) => supabase.from('project_tasks').select('id, title, archived_at, board:project_boards(project_id)').in('id', w),
    (rows) =>
      rows.forEach((r) => {
        const project = boardProject(r.board)
        if (project) open('ct', r.id, r.title, `${paths.classProject(project)}?task=${r.id}`, r.archived_at)
      }),
  )
  read<{ id: string; title: string; origin_id: string; archived_at: string | null; board: Board }>(
    'co',
    (w) =>
      supabase
        .from('project_tasks')
        .select('id, title, origin_id, archived_at, board:project_boards(project_id)')
        .in('origin_id', w),
    (rows) => {
      const byOrigin = new Map<string, typeof rows>()
      for (const r of rows) byOrigin.set(r.origin_id, [...(byOrigin.get(r.origin_id) ?? []), r])
      for (const [origin, copies] of byOrigin) {
        const first = copies[0]
        const project = boardProject(first.board)
        if (!project) continue
        // One copy is the reader's own; several means they teach the class.
        const href =
          copies.length === 1 ? `${paths.classProject(project)}?task=${first.id}` : `${paths.classProject(project)}?tab=tasks`
        open('co', origin, first.title, href, copies.every((c) => c.archived_at !== null) ? first.archived_at : null)
      }
    },
  )
  read<{ id: string; title: string; archived_at: string | null }>(
    'cp',
    (w) => supabase.from('projects').select('id, title, archived_at').in('id', w),
    (rows) => rows.forEach((r) => open('cp', r.id, r.title, paths.classProject(r.id), r.archived_at)),
  )

  await Promise.all(reads)
  return out
}
