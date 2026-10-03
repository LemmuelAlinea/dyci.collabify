/** How My tasks lays out the same tasks: by urgency, by stage, or one flat table. */
export type MyTasksView = 'urgency' | 'board' | 'list'

const VIEWS: MyTasksView[] = ['urgency', 'board', 'list']

const VIEW_KEY = 'collabify:my-tasks-view'

/** `?view=` first, then the last one this reader picked, then Urgency. */
export function readMyTasksView(params: URLSearchParams): MyTasksView {
  const known = (v: string | null): v is MyTasksView => (VIEWS as (string | null)[]).includes(v)
  const raw = params.get('view')
  if (known(raw)) return raw
  try {
    const saved = localStorage.getItem(VIEW_KEY)
    if (known(saved)) return saved
  } catch {
    // Storage blocked: Urgency it is.
  }
  return 'urgency'
}

/** Writes `?view=` (Urgency removes it) and remembers the pick for next time. */
export function writeMyTasksView(params: URLSearchParams, view: MyTasksView): URLSearchParams {
  try {
    localStorage.setItem(VIEW_KEY, view)
  } catch {
    // Only the URL carries it, then.
  }
  const next = new URLSearchParams(params)
  if (view === 'urgency') next.delete('view')
  else next.set('view', view)
  return next
}
