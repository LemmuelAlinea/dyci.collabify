import { supabase } from '../supabase'

/** Whether anybody has let the signed-in account in yet. See `am_i_admitted`. */
export async function amIAdmitted() {
  const { data, error } = await supabase.rpc('am_i_admitted')
  if (error) throw error
  return Boolean(data)
}
