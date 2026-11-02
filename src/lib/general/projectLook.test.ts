import { describe, expect, it } from 'vitest'
import type { IconName } from '../../components/ui/Icon'
import { contrast } from '../palette'
import { PROJECT_COLORS, PROJECT_ICONS, PROJECT_VIEWS, colorAccent, colorTile, isCustomColor } from './projectLook'

describe('project look', () => {
  it('offers 8 colors and 20 icons without repeats', () => {
    expect(PROJECT_COLORS).toHaveLength(8)
    expect(PROJECT_ICONS).toHaveLength(20)
    expect(new Set(PROJECT_COLORS).size).toBe(8)
    expect(new Set(PROJECT_ICONS).size).toBe(20)
  })

  it('names the colors the database accepts', () => {
    expect([...PROJECT_COLORS]).toEqual(['navy', 'amber', 'green', 'teal', 'violet', 'rose', 'orange', 'slate'])
  })

  it('draws every icon from the Icon set', () => {
    // The real check is this type assignment, enforced by tsc; the assertion only keeps it used.
    const asNames: readonly IconName[] = PROJECT_ICONS
    expect(asNames).toBe(PROJECT_ICONS)
  })

  it('draws a named color from its classes and a custom color inline', () => {
    expect(colorTile('teal')).toEqual({ className: 'bg-swatch-teal text-swatch-teal-ink' })
    expect(colorAccent('teal')).toEqual({ className: 'text-swatch-teal-accent' })
    expect(colorTile('#ffe08a').style).toEqual({ background: '#ffe08a', color: '#10162e' })
    expect(colorTile('#1a2b6c').style?.color).toBe('#fef7e6')
    expect(isCustomColor('#1a2b6c')).toBe(true)
    expect(isCustomColor('navy')).toBe(false)
  })

  it('lifts a dark custom accent until it reads on the banner', () => {
    const word = colorAccent('#101a40').style!.color as string
    expect(contrast(word, '#10162e')).toBeGreaterThanOrEqual(4.5)
  })

  it('labels the three default views', () => {
    expect(PROJECT_VIEWS.map((v) => v.label)).toEqual(['Overview', 'Plan', 'Tasks'])
    expect(PROJECT_VIEWS.map((v) => v.value)).toEqual(['overview', 'plan', 'tasks'])
  })
})
