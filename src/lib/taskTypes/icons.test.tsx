import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Icon } from '../../components/ui/Icon'
import { TASK_TYPE_ICONS, TYPE_ICON_GLYPH, typeIconLabel } from './icons'

const sql = readFileSync(new URL('../../../supabase/task-type-looks.sql', import.meta.url), 'utf8')

describe('TASK_TYPE_ICONS', () => {
  it('is the list the database accepts, in the same order', () => {
    const list = sql.match(/task_type_icon_keys\(\)[\s\S]*?array\[([^\]]*)\]/)
    expect(list).not.toBeNull()
    const allowed = [...list![1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
    expect(allowed).toEqual([...TASK_TYPE_ICONS])
  })

  it('holds 68 distinct keys, tag included', () => {
    expect(TASK_TYPE_ICONS).toHaveLength(68)
    expect(new Set(TASK_TYPE_ICONS).size).toBe(68)
    expect(TASK_TYPE_ICONS).toContain('tag')
  })

  it('draws every key', () => {
    for (const key of TASK_TYPE_ICONS) {
      const html = renderToStaticMarkup(<Icon name={TYPE_ICON_GLYPH[key]} />)
      expect(html, key).toMatch(/ d="M[^"]+"/)
    }
  })

  it('names each key for the picker', () => {
    expect(typeIconLabel('square-check')).toBe('Square check')
    expect(typeIconLabel('arrow-left-right')).toBe('Arrow left right')
    const labels = TASK_TYPE_ICONS.map(typeIconLabel)
    expect(new Set(labels).size).toBe(labels.length)
    for (const label of labels) expect(label).toMatch(/^[A-Z]/)
  })
})
