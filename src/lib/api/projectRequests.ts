import { supabase } from '../supabase'
import type { PresetPayload } from '../general/presets'

export type ProjectRequest = {
  id: string
  space_id: string
  author_id: string
  title: string
  brief: string
  desired_outcome: string
  target_date: string | null
  status: 'open' | 'ready' | 'converted' | 'closed'
  converted_project_id: string | null
  created_at: string
  updated_at: string
}

export type ProjectRequestMessage = {
  id: string
  request_id: string
  author_id: string
  body: string
  created_at: string
}

export async function listProjectRequests(spaceId: string): Promise<ProjectRequest[]> {
  const { data, error } = await supabase.from('general_project_requests').select('*').eq('space_id', spaceId).order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as ProjectRequest[]
}

export async function requestForProject(projectId: string): Promise<ProjectRequest | null> {
  const { data, error } = await supabase.from('general_project_requests').select('*').eq('converted_project_id', projectId).maybeSingle()
  if (error) throw error
  return data as ProjectRequest | null
}

export async function listProjectRequestMessages(requestId: string): Promise<ProjectRequestMessage[]> {
  const { data, error } = await supabase.from('general_project_request_messages').select('*').eq('request_id', requestId).order('created_at')
  if (error) throw error
  return (data ?? []) as ProjectRequestMessage[]
}

export async function createProjectRequest(input: { spaceId: string; title: string; brief: string; outcome: string; targetDate: string | null }): Promise<string> {
  const { data, error } = await supabase.rpc('create_general_project_request', {
    p_space: input.spaceId, p_title: input.title, p_brief: input.brief,
    p_outcome: input.outcome, p_target_date: input.targetDate,
  })
  if (error) throw error
  return data as string
}

export async function editProjectRequest(input: { id: string; title: string; brief: string; outcome: string; targetDate: string | null }): Promise<void> {
  const { error } = await supabase.rpc('edit_general_project_request', {
    p_request: input.id, p_title: input.title, p_brief: input.brief,
    p_outcome: input.outcome, p_target_date: input.targetDate,
  })
  if (error) throw error
}

export async function postProjectRequestMessage(requestId: string, body: string): Promise<string> {
  const { data, error } = await supabase.rpc('post_general_project_request_message', { p_request: requestId, p_body: body })
  if (error) throw error
  return data as string
}

export async function setProjectRequestStatus(requestId: string, status: 'ready' | 'closed'): Promise<void> {
  const { error } = await supabase.rpc('set_general_project_request_status', { p_request: requestId, p_status: status })
  if (error) throw error
}

export async function createProjectFromRequest(requestId: string, options: { preset?: string | null; content?: PresetPayload | null; spaceTeamId?: string | null }): Promise<string> {
  const { data, error } = await supabase.rpc('create_general_project_from_request', {
    p_request: requestId, p_preset: options.preset ?? null,
    p_content: options.content ?? null, p_space_team: options.spaceTeamId ?? null,
  })
  if (error) throw error
  return data as string
}
