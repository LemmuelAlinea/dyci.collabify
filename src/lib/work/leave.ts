const manilaTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Manila',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/**
 * A due date moved to another day (YYYY-MM-DD), keeping its time of day in
 * Manila; 17:00 Manila when the task had no due date. Returns an ISO string.
 */
export function moveDueDate(dueAt: string | null, day: string): string {
  const time = dueAt ? manilaTime.format(new Date(dueAt)) : '17:00'
  return new Date(`${day}T${time}:00+08:00`).toISOString()
}
