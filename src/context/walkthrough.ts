import { createContext, useContext } from 'react'

export type WalkthroughValue = {
  /** Whether this account has walkthroughs to replay from Settings. */
  canReplay: boolean
  /** Walks every step again. Writes no progress. */
  startReplay: () => void
}

const NONE: WalkthroughValue = { canReplay: false, startReplay: () => {} }

export const WalkthroughContext = createContext<WalkthroughValue>(NONE)

/** Outside the provider there is nothing to replay. */
export function useWalkthrough() {
  return useContext(WalkthroughContext)
}
