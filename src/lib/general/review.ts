/** Whether this person was asked to review the change, by name or as one of several. */
export function isReviewer(change: { reviewer_id: string | null; reviewer_ids?: string[] | null }, viewerId: string | null) {
  if (!viewerId) return false
  return (change.reviewer_ids ?? []).includes(viewerId) || change.reviewer_id === viewerId
}

export function groupChanges<
  T extends { author_id: string | null; reviewer_id: string | null; reviewer_ids?: string[] | null; status: string },
>(changes: T[], viewerId: string | null) {
  const mine: T[] = []
  const toMe: T[] = []
  const others: T[] = []
  for (const change of changes) {
    if (viewerId && change.author_id === viewerId) mine.push(change)
    else if (isReviewer(change, viewerId)) toMe.push(change)
    else if (change.status === 'open') others.push(change)
  }
  return { mine, toMe, others }
}
