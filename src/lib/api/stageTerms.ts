import { supabase } from '../supabase'
import type { StageTerms } from '../work/stageTerms'
import { DEFAULT_STAGE_TERMS } from '../work/stageTerms'

export async function getBoardStageTerms(boardId: string): Promise<StageTerms> {
  const { data, error } = await supabase.from('project_boards')
    .select('term_singular, term_plural').eq('id', boardId).maybeSingle()
  if (error) throw error
  return data ? { singular: data.term_singular, plural: data.term_plural } : DEFAULT_STAGE_TERMS
}

export async function saveBoardStageTerms(boardId: string, terms: StageTerms) {
  const { error } = await supabase.rpc('set_board_stage_terms', {
    p_board: boardId,
    p_singular: terms.singular,
    p_plural: terms.plural,
  })
  if (error) throw error
}
