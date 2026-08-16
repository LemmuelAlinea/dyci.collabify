import { supabase } from '../supabase'

export const POLL_SELECT = `
  poll:polls!polls_message_id_fkey (
    id, message_id, conversation_id, created_by, question,
    allow_multiple, allow_new_options, closed_at,
    options:poll_options (id, poll_id, label, position),
    votes:poll_votes (
      option_id, user_id,
      voter:profiles!poll_votes_user_id_fkey (first_name, last_name, avatar_url)
    )
  )
`

export async function createPoll(input: {
  conversationId: string
  question: string
  options: string[]
  allowMultiple: boolean
  allowNewOptions: boolean
}) {
  const { data, error } = await supabase.rpc('create_poll', {
    p_conversation: input.conversationId,
    p_question: input.question,
    p_options: input.options,
    p_allow_multiple: input.allowMultiple,
    p_allow_new_options: input.allowNewOptions,
  })
  if (error) throw error
  return data as {
    result: 'ok' | 'not_a_member' | 'read_only' | 'no_question' | 'not_signed_in'
    poll_id?: string
  }
}

export async function castVote(optionId: string, selected: boolean) {
  const { data, error } = await supabase.rpc('cast_poll_vote', {
    p_option: optionId,
    p_selected: selected,
  })
  if (error) throw error
  return data as { result: 'ok' | 'closed' | 'not_a_member' | 'not_found' }
}

export async function addPollOption(pollId: string, label: string) {
  const { data, error } = await supabase.rpc('add_poll_option', {
    p_poll: pollId,
    p_label: label,
  })
  if (error) throw error
  return data as {
    result: 'ok' | 'closed' | 'not_allowed' | 'duplicate' | 'empty' | 'not_a_member' | 'not_found'
  }
}

export async function setPollClosed(pollId: string, closed: boolean) {
  const { data, error } = await supabase.rpc('set_poll_closed', {
    p_poll: pollId,
    p_closed: closed,
  })
  if (error) throw error
  return data as { result: 'ok' | 'not_allowed' }
}

export const POLL_MESSAGE: Record<string, string> = {
  closed: 'This poll is closed, so it can no longer change.',
  not_allowed: 'Only the person who made this poll, or the professor, can do that.',
  duplicate: 'That option is already on the poll.',
  empty: 'Type an option first.',
  not_a_member: 'You are not in this conversation.',
  not_found: 'That poll no longer exists.',
  read_only: 'This class is archived, so the chat is read-only.',
  no_question: 'Give the poll a question.',
}
