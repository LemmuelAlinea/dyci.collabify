// src/lib/taskTypes/typeSet.ts
/**
 * A project's task types (supabase/task-type-looks.sql): an ordered list with a default slot, a bug
 * slot on work projects, and up to 20 custom types. Tasks keep their own columns: a work task maps
 * by kind ('bug' → the bug slot), then a null task_type (the default), then by name; a class task by
 * 'Task' (the default), then by name. A name the set no longer holds is a removed type, drawn gray.
 */
import { isTaskTypeIcon, TASK_TYPE_ICONS } from './icons'
import type { TaskTypeIcon } from './icons'

export type TypeFamily = 'work' | 'class'
export type TypeSlot = 'default' | 'bug' | null
export type TaskTypeEntry = { slot: TypeSlot; name: string; description: string; color: string; icon: TaskTypeIcon }
/** An entry as the editor saves it: `was` is its name when the editor loaded it. */
export type TaskTypeDraft = TaskTypeEntry & { was?: string }
export type ResolvedType = TaskTypeEntry & { removed: boolean }
export type TypeOption = { value: string; entry: ResolvedType }
type Role = 'pm' | 'coordinator' | 'member' | 'qa' | 'stakeholder' | null | undefined

const DEFAULT_ENTRY: TaskTypeEntry = {
  slot: 'default', name: 'Task', description: 'Standard actionable work.', color: '#2563eb', icon: 'square-check',
}
const BUG_ENTRY: TaskTypeEntry = {
  slot: 'bug', name: 'Bug', description: 'Errors, defects, and issues requiring fixes.', color: '#dc2626', icon: 'bug',
}

export function defaultTypeSet(family: TypeFamily): TaskTypeEntry[] {
  return family === 'class' ? [{ ...DEFAULT_ENTRY }] : [{ ...DEFAULT_ENTRY }, { ...BUG_ENTRY }]
}

export const MAX_CUSTOM_TYPES = 20

const SHAPE = 'Each task type needs a slot, name, description, color and icon.'
const namesMessage = (family: TypeFamily) => family === 'class'
  ? 'Use distinct names of 1 to 40 characters. Task stays reserved for the built-in type.'
  : 'Use distinct names of 1 to 40 characters. Task and Bug stay reserved for the built-in types.'

/** Null when the set is valid, else the message: task_type_set_problem in SQL, message for message. */
export function typeSetProblem(set: TaskTypeEntry[], family: TypeFamily): string | null {
  if (!Array.isArray(set)) return SHAPE
  for (const t of set) {
    if (!t || typeof t !== 'object' || typeof t.name !== 'string' || typeof t.description !== 'string'
      || typeof t.color !== 'string' || typeof t.icon !== 'string'
      || !(t.slot === null || t.slot === 'default' || t.slot === 'bug')) return SHAPE
  }
  if (set.filter((t) => t.slot === 'default').length !== 1) return 'Keep one default type.'
  const bugs = set.filter((t) => t.slot === 'bug').length
  if (family === 'class' && bugs > 0) return 'Class projects have no bug type.'
  if (family === 'work' && bugs !== 1) return 'Keep one bug type.'
  if (set.filter((t) => t.slot === null).length > MAX_CUSTOM_TYPES) return 'Keep at most 20 custom task types.'
  const seen = new Set<string>()
  for (const t of set) {
    const lower = t.name.toLowerCase()
    const reserved = t.slot === null && (lower === 'task' || (family === 'work' && lower === 'bug'))
    if (t.name !== t.name.trim() || t.name.length < 1 || t.name.length > 40 || seen.has(lower) || reserved) {
      return namesMessage(family)
    }
    seen.add(lower)
  }
  if (set.some((t) => t.description.length > 120 || t.description !== t.description.trim())) {
    return 'Keep each description to 120 characters.'
  }
  if (set.some((t) => !/^#[0-9a-f]{6}$/.test(t.color))) return 'Choose a color as #rrggbb.'
  if (set.some((t) => !(TASK_TYPE_ICONS as readonly string[]).includes(t.icon))) return 'Choose an icon from the list.'
  return null
}

/** A stored set, or the default when what was read isn't one. */
export function parseTypeSet(raw: unknown, family: TypeFamily): TaskTypeEntry[] {
  if (!Array.isArray(raw)) return defaultTypeSet(family)
  const set = raw.map((t) => (t && typeof t === 'object'
    ? { slot: t.slot ?? null, name: t.name, description: t.description, color: t.color, icon: t.icon }
    : t)) as TaskTypeEntry[]
  return set.every((t) => t && isTaskTypeIcon(t.icon)) && typeSetProblem(set, family) === null ? set : defaultTypeSet(family)
}

/** The value a task stores for this type: 'task' | 'bug' | name on work, 'Task' | name on class. */
export function typeKey(entry: Pick<TaskTypeEntry, 'slot' | 'name'>, family: TypeFamily): string {
  if (entry.slot === 'default') return family === 'class' ? 'Task' : 'task'
  if (entry.slot === 'bug') return 'bug'
  return entry.name
}

const removed = (name: string): ResolvedType => ({ slot: null, name, description: '', color: '#64748b', icon: 'tag', removed: true })

export function resolveType(
  set: TaskTypeEntry[],
  task: { kind?: 'task' | 'bug' | null; task_type?: string | null },
  family: TypeFamily,
): ResolvedType {
  const slot = (s: 'default' | 'bug') => set.find((t) => t.slot === s)
  let hit: TaskTypeEntry | undefined
  if (family === 'work' && task.kind === 'bug') hit = slot('bug')
  else if (family === 'work' ? !task.task_type : !task.task_type || task.task_type === 'Task') hit = slot('default')
  else hit = set.find((t) => t.slot === null && t.name === task.task_type)
  if (hit) return { ...hit, removed: false }
  return removed(task.task_type ?? (task.kind === 'bug' ? 'Bug' : 'Task'))
}

/**
 * The choices a type picker offers, in set order. QA gets the bug type only; a planned project's
 * Member never gets it; a task whose type was removed keeps it as its current choice, last.
 */
export function typeOptions(
  set: TaskTypeEntry[],
  opts: { family: TypeFamily; role?: Role; memberPlanned?: boolean; current?: ResolvedType },
): TypeOption[] {
  const options = set
    .filter((t) => (opts.role === 'qa' ? t.slot === 'bug' : !(opts.memberPlanned && t.slot === 'bug')))
    .map((t) => ({ value: typeKey(t, opts.family), entry: { ...t, removed: false } }))
  if (opts.current?.removed) options.push({ value: opts.current.name, entry: opts.current })
  return options
}

/** Names tasks carry that the set no longer holds, once each, in the order met. */
export function removedNames(set: TaskTypeEntry[], names: (string | null | undefined)[], family: TypeFamily): string[] {
  const live = new Set(set.filter((t) => t.slot === null).map((t) => t.name))
  const out: string[] = []
  for (const name of names) {
    if (!name || live.has(name) || (family === 'class' && name === 'Task') || out.includes(name)) continue
    out.push(name)
  }
  return out
}

/** The set to save: each custom entry renamed in the editor carries the name it was loaded with. */
export function withWas(edited: TaskTypeEntry[], loaded: TaskTypeEntry[], renames: Map<number, string>): TaskTypeDraft[] {
  const loadedNames = new Set(loaded.filter((t) => t.slot === null).map((t) => t.name))
  return edited.map((t, i) => {
    const was = renames.get(i)
    return t.slot === null && was && was !== t.name && loadedNames.has(was) ? { ...t, was } : { ...t }
  })
}
