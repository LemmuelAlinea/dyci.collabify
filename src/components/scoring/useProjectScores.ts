import { useCallback, useEffect, useRef, useState } from 'react'
import { useLive } from '../../hooks/useLive'
import { useToast } from '../ui/Toast'
import { projectPeerResults } from '../../lib/api/peer'
import { listCriteria } from '../../lib/api/projects'
import { projectBoardScores, scoreSheet } from '../../lib/api/scores'
import { authErrorMessage } from '../../lib/authError'
import type { BoardScore, PeerResult, ProjectCriterion, ScoreSheetRow } from '../../lib/types'

type ScoreData = {
  criteria: ProjectCriterion[]
  boardScores: BoardScore[]
  sheet: ScoreSheetRow[]
  /** The final round's peer results, for the flags beside each member. */
  finalPeer: PeerResult[]
}

export type ProjectScores = ScoreData & {
  loaded: boolean
  reload: () => Promise<void>
}

const EMPTY: ScoreData = { criteria: [], boardScores: [], sheet: [], finalPeer: [] }

/** Everything the grading table and score card read, loaded once for the page. */
export function useProjectScores(projectId: string, boardIds: string[]): ProjectScores {
  const { show } = useToast()
  const [data, setData] = useState<ScoreData>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  // Live updates retry the load often; one toast until it works again is enough.
  const erroredRef = useRef(false)
  const key = boardIds.join(',')

  const reload = useCallback(async () => {
    try {
      const ids = key ? key.split(',') : []
      const [criteria, boardScores, sheet, peer] = await Promise.all([
        listCriteria(projectId),
        projectBoardScores(ids),
        scoreSheet(projectId),
        projectPeerResults(projectId),
      ])
      setData({ criteria, boardScores, sheet, finalPeer: peer.filter((r) => r.kind === 'final') })
      setLoaded(true)
      erroredRef.current = false
    } catch (err) {
      if (erroredRef.current) return
      erroredRef.current = true
      show(authErrorMessage(err, 'Could not load the grades. Reload the page to try again.'), 'error')
    }
  }, [projectId, key, show])

  useEffect(() => {
    void reload()
  }, [reload])
  useLive(reload, ['board_scores', 'member_scores', 'score_releases', 'project_criteria', 'peer_rounds'])

  return { ...data, loaded, reload }
}
