import { useEffect, useMemo, useState } from 'react'
import { resolveMentions, type ResolvedMention } from '../lib/api/mentions'
import { mentionKey, type MentionRef } from '../lib/mentions'

/**
 * What every mention in view is for this reader, looked up in one batch per
 * kind. Earlier answers are kept; only new mentions are looked up. A mention
 * not looked up yet, or whose read failed, is missing and shows as locked.
 */
export function useMentionTitles(refs: MentionRef[]): Map<string, ResolvedMention> {
  const [resolved, setResolved] = useState<Map<string, ResolvedMention>>(() => new Map())
  const key = useMemo(() => [...new Set(refs.map(mentionKey))].sort().join(','), [refs])

  useEffect(() => {
    if (!key) return
    const wanted = key
      .split(',')
      .filter((k) => !resolved.has(k))
      .map((k) => {
        const [kind, id] = k.split(':')
        return { kind, id } as MentionRef
      })
    if (wanted.length === 0) return
    let live = true
    resolveMentions(wanted)
      .then((found) => {
        if (!live || found.size === 0) return
        setResolved((prev) => new Map([...prev, ...found]))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
    // `resolved` is read, not watched: a new answer must not trigger a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return resolved
}
