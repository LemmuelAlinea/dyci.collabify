export function groupChanges<T extends { author_id: string | null; reviewer_id: string | null; status: string }>(
  changes: T[],
  viewerId: string | null,
) {
  const mine: T[] = []
  const toMe: T[] = []
  const others: T[] = []
  for (const change of changes) {
    if (viewerId && change.author_id === viewerId) mine.push(change)
    else if (viewerId && change.reviewer_id === viewerId) toMe.push(change)
    else if (change.status === 'open') others.push(change)
  }
  return { mine, toMe, others }
}
