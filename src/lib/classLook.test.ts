import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CLASS_ICONS, classIconLabel, isClassIcon } from './classLook'

const sql = readFileSync(new URL('../../supabase/class-look.sql', import.meta.url), 'utf8')

describe('CLASS_ICONS', () => {
  it('is the same set the database accepts', () => {
    const check = sql.match(/check \(icon in \(([^)]*)\)\)/)
    expect(check).not.toBeNull()
    const allowed = [...check![1].matchAll(/'([a-z]+)'/g)].map((m) => m[1])
    expect([...allowed].sort()).toEqual([...CLASS_ICONS].sort())
  })

  it('names each icon for the picker', () => {
    for (const icon of CLASS_ICONS) expect(classIconLabel(icon)).toMatch(/^[A-Z]/)
    expect(new Set(CLASS_ICONS.map(classIconLabel)).size).toBe(CLASS_ICONS.length)
  })

  it('recognizes only the class icons', () => {
    expect(isClassIcon('code')).toBe(true)
    expect(isClassIcon('kanban')).toBe(false)
    expect(isClassIcon(null)).toBe(false)
  })
})
