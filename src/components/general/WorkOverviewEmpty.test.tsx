import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { WorkGlance } from '../work/WorkGlance'
import { ForecastPanel } from './ForecastPanel'
import { PressurePanel } from './PressurePanel'
import type { GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('React', React)
vi.mock('../../hooks/useNow', () => ({ useNow: () => Date.parse('2026-11-16T00:00:00Z') }))

const state = {
  project: { ends_on: null },
  tasks: [],
} as unknown as GeneralProjectState

it('uses the Home banner panel for empty Overview cards', () => {
  const html = [
    renderToStaticMarkup(<WorkGlance items={[]} sprints={[]} milestones={[]} mine={new Set()} canPlan onOpenTask={() => {}} onSection={() => {}} />),
    renderToStaticMarkup(<ForecastPanel state={state} />),
    renderToStaticMarkup(<PressurePanel state={state} onOpen={() => {}} />),
  ].join('')

  expect(html.match(/bg-banner-tile text-banner-tile-glyph/g)).toHaveLength(5)
  expect(html).toContain('No sprint is running.')
  expect(html).toContain('No milestones yet.')
  expect(html).toContain('Nothing needs you right now.')
  expect(html).toContain('This project has no tasks yet.')
  expect(html).toContain('Nothing is overdue')
})
