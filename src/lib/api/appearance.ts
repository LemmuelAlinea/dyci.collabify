/**
 * Each person's own colours: the set in use, and palettes saved by name.
 * Owner-only by RLS. See supabase/appearance.sql and lib/palette.ts.
 */
import { supabase } from '../supabase'
import { cleanColors } from '../palette'
import type { PaletteColors } from '../palette'

export type SavedPalette = {
  id: string
  name: string
  colors: PaletteColors
  updated_at: string
}

/** The colours in use, or empty when the person never changed any. */
export async function getMyAppearance(): Promise<PaletteColors> {
  const { data, error } = await supabase.from('user_appearance').select('colors').maybeSingle()
  if (error) throw error
  return cleanColors(data?.colors)
}

export async function saveMyAppearance(userId: string, colors: PaletteColors) {
  const { error } = await supabase
    .from('user_appearance')
    .upsert({ user_id: userId, colors: cleanColors(colors), updated_at: new Date().toISOString() })
  if (error) throw error
}

export async function listPalettes(): Promise<SavedPalette[]> {
  const { data, error } = await supabase
    .from('appearance_palettes')
    .select('id, name, colors, updated_at')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((p) => ({ ...p, colors: cleanColors(p.colors) }) as SavedPalette)
}

export async function createPalette(name: string, colors: PaletteColors) {
  const { data, error } = await supabase
    .from('appearance_palettes')
    .insert({ name, colors: cleanColors(colors) })
    .select('id, name, colors, updated_at')
    .single()
  if (error) throw error
  return { ...data, colors: cleanColors(data.colors) } as SavedPalette
}

export async function updatePalette(id: string, patch: { name?: string; colors?: PaletteColors }) {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.colors !== undefined) row.colors = cleanColors(patch.colors)
  const { error } = await supabase.from('appearance_palettes').update(row).eq('id', id)
  if (error) throw error
}

export async function deletePalette(id: string) {
  const { error } = await supabase.from('appearance_palettes').delete().eq('id', id)
  if (error) throw error
}

/** Says what went wrong in words a person can act on. */
export function paletteErrorMessage(err: unknown): string {
  const e = err as { code?: string; message?: string }
  if (e?.code === '23505') return 'You already have a palette with that name. Pick another.'
  if (e?.code === '23514' && e.message?.includes('12 saved')) return e.message
  if (e?.code === '23514') return 'That name or one of the colours is not allowed. Check them and try again.'
  return 'The palette did not save. Check your connection and try again.'
}
