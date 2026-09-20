// src/hooks/useSpaces.ts
/**
 * Which space you are working in, and the ones you could switch to.
 *
 * The space lives in the URL so a link to a space is a link somebody else can
 * open. What the browser remembers is only which one to land on when the URL
 * does not say — and that memory is never trusted on its own: a remembered id
 * is checked against what you are actually in before it is used, or leaving a
 * space would leave you pointed at a page you can no longer read.
 */
import { useCallback, useEffect, useState } from 'react'
import { listMySpaceInvitations, listMySpaces } from '../lib/api/spaces'
import { authErrorMessage } from '../lib/authError'
import { chooseLandingSpace } from '../lib/general/navigation'
import type { GeneralSpaceSummary, MySpaceInvitation } from '../lib/general/types'

const KEY = 'collabify:last-space'

/** localStorage throws in a private window and is empty on a new device. */
export function rememberSpace(id: string) {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* not worth telling anybody about */
  }
}

export function forgetSpace() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* as above */
  }
}

export function rememberedSpace(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

/**
 * Where /general should send somebody.
 *
 * The remembered space, if they are still in it; otherwise their only space,
 * if they have exactly one; otherwise the picker, because choosing for them
 * when there are several would be guessing.
 */
export function landingSpace(spaces: GeneralSpaceSummary[]): string | null {
  return chooseLandingSpace(spaces, rememberedSpace())
}

export type SpacesState = {
  spaces: GeneralSpaceSummary[] | null
  invitations: MySpaceInvitation[]
  error: string | null
  reload: () => Promise<void>
}

export function useMySpaces(enabled = true): SpacesState {
  const [spaces, setSpaces] = useState<GeneralSpaceSummary[] | null>(null)
  const [invitations, setInvitations] = useState<MySpaceInvitation[]>([])
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const [s, i] = await Promise.all([listMySpaces(), listMySpaceInvitations()])
      setSpaces(s)
      setInvitations(i)
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load your spaces.'))
      setSpaces((prev) => prev ?? [])
    }
  }, [])

  useEffect(() => {
    if (enabled) void reload()
  }, [enabled, reload])

  return { spaces, invitations, error, reload }
}
