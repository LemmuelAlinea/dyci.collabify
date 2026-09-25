/** How report figures and dates are written, on the page and in CSV alike. */

export const hours = (minutes: number) => {
  const h = Math.round((Number(minutes) / 60) * 10) / 10
  return `${h}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "14 Sep 2026", in the viewer's local calendar. */
export const day = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
export const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
export const moment = (iso: string | null) => (iso ? `${day(iso)}, ${time(iso)}` : '')
export const STATUS: Record<string, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done' }
export const REVIEW: Record<string, string> = { open: 'Open', applied: 'Merged', declined: 'Declined', withdrawn: 'Withdrawn' }
